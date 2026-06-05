use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, Transport};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

struct MqttConnection {
    client: AsyncClient,
    poll_handle: JoinHandle<()>,
    config_key: String,
}

pub struct MqttState {
    connections: Arc<Mutex<HashMap<String, MqttConnection>>>,
}

impl Default for MqttState {
    fn default() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnectRequest {
    pub tab_id: String,
    pub broker: String,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub keep_alive: Option<u64>,
    #[serde(default)]
    pub subscribe_topic: Option<String>,
    #[serde(default)]
    pub qos: Option<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttPublishRequest {
    pub tab_id: String,
    pub topic: String,
    #[serde(default)]
    pub payload: Option<String>,
    #[serde(default)]
    pub qos: Option<u8>,
    #[serde(default)]
    pub retain: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct MqttCommandResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MqttEventPayload {
    tab_id: String,
    event_type: String,
    broker: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    topic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    qos: Option<u8>,
}

fn emit_event(app: &AppHandle, payload: MqttEventPayload) {
    let _ = app.emit("mqtt-event", payload);
}

fn qos_from_u8(value: u8) -> QoS {
    match value {
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtMostOnce,
    }
}

/// Parse a broker URL like `mqtt://host:1883` or `mqtts://host:8883` into
/// (host, port, use_tls). Bare `host:port` is treated as plaintext MQTT.
fn parse_broker(broker: &str) -> Result<(String, u16, bool), String> {
    let trimmed = broker.trim();
    if trimmed.is_empty() {
        return Err("Broker URL is required".to_string());
    }

    let (scheme, rest) = match trimmed.split_once("://") {
        Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
        None => (String::from("mqtt"), trimmed),
    };

    let use_tls = match scheme.as_str() {
        "mqtt" | "tcp" => false,
        "mqtts" | "ssl" | "tls" => true,
        other => return Err(format!("Unsupported MQTT scheme '{}'", other)),
    };

    // Strip any path/query that may follow the authority.
    let authority = rest.split(['/', '?']).next().unwrap_or(rest);
    let default_port = if use_tls { 8883 } else { 1883 };

    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port_str)) => {
            let port = port_str
                .parse::<u16>()
                .map_err(|_| format!("Invalid MQTT port '{}'", port_str))?;
            (host.to_string(), port)
        }
        None => (authority.to_string(), default_port),
    };

    if host.is_empty() {
        return Err("MQTT broker host is required".to_string());
    }

    Ok((host, port, use_tls))
}

fn build_config_key(request: &MqttConnectRequest, host: &str, port: u16, use_tls: bool) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        host,
        port,
        use_tls,
        request.client_id.clone().unwrap_or_default(),
        request.username.clone().unwrap_or_default(),
        request.password.clone().unwrap_or_default(),
        request.keep_alive.unwrap_or(60),
        request.subscribe_topic.clone().unwrap_or_default(),
    )
}

async fn remove_connection(
    state: &Arc<Mutex<HashMap<String, MqttConnection>>>,
    tab_id: &str,
) -> Option<MqttConnection> {
    let mut connections = state.lock().await;
    connections.remove(tab_id)
}

async fn establish_connection(
    app: AppHandle,
    state: Arc<Mutex<HashMap<String, MqttConnection>>>,
    request: &MqttConnectRequest,
    host: String,
    port: u16,
    use_tls: bool,
    config_key: String,
) -> Result<AsyncClient, String> {
    let client_id = request
        .client_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("resonance-{}", &uuid::Uuid::new_v4().to_string()[..8]));

    let mut mqtt_options = MqttOptions::new(client_id, host.clone(), port);
    mqtt_options.set_keep_alive(Duration::from_secs(request.keep_alive.unwrap_or(60)));

    if let Some(username) = request.username.as_ref().filter(|value| !value.is_empty()) {
        mqtt_options.set_credentials(username, request.password.clone().unwrap_or_default());
    }

    if use_tls {
        mqtt_options.set_transport(Transport::tls_with_default_config());
    }

    let (client, mut eventloop) = AsyncClient::new(mqtt_options, 10);

    let poll_app = app.clone();
    let poll_state = state.clone();
    let poll_tab_id = request.tab_id.clone();
    let poll_broker = request.broker.clone();
    let poll_handle = tokio::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(_))) => {
                    emit_event(
                        &poll_app,
                        MqttEventPayload {
                            tab_id: poll_tab_id.clone(),
                            event_type: "connect".to_string(),
                            broker: poll_broker.clone(),
                            topic: None,
                            message: None,
                            qos: None,
                        },
                    );
                }
                Ok(Event::Incoming(Packet::Publish(publish))) => {
                    let body = String::from_utf8_lossy(&publish.payload).to_string();
                    emit_event(
                        &poll_app,
                        MqttEventPayload {
                            tab_id: poll_tab_id.clone(),
                            event_type: "message".to_string(),
                            broker: poll_broker.clone(),
                            topic: Some(publish.topic.clone()),
                            message: Some(body),
                            qos: Some(publish.qos as u8),
                        },
                    );
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    emit_event(
                        &poll_app,
                        MqttEventPayload {
                            tab_id: poll_tab_id.clone(),
                            event_type: "error".to_string(),
                            broker: poll_broker.clone(),
                            topic: None,
                            message: Some(error.to_string()),
                            qos: None,
                        },
                    );
                    break;
                }
            }
        }

        // Emit a single terminal disconnect when the loop ends (broker close or
        // error). On an explicit abort (user disconnect / tab close) this code does
        // not run — the frontend already handles UI cleanup in those paths.
        emit_event(
            &poll_app,
            MqttEventPayload {
                tab_id: poll_tab_id.clone(),
                event_type: "disconnect".to_string(),
                broker: poll_broker.clone(),
                topic: None,
                message: None,
                qos: None,
            },
        );
        remove_connection(&poll_state, &poll_tab_id).await;
    });

    {
        let mut connections = state.lock().await;
        connections.insert(
            request.tab_id.clone(),
            MqttConnection {
                client: client.clone(),
                poll_handle,
                config_key,
            },
        );
    }

    Ok(client)
}

#[tauri::command]
pub async fn mqtt_connect(
    app: AppHandle,
    state: State<'_, MqttState>,
    request: MqttConnectRequest,
) -> Result<MqttCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    let (host, port, use_tls) = match parse_broker(&request.broker) {
        Ok(parsed) => parsed,
        Err(error) => {
            emit_event(
                &app,
                MqttEventPayload {
                    tab_id: request.tab_id.clone(),
                    event_type: "error".to_string(),
                    broker: request.broker.clone(),
                    topic: None,
                    message: Some(error.clone()),
                    qos: None,
                },
            );
            return Err(error);
        }
    };

    let config_key = build_config_key(&request, &host, port, use_tls);

    // Reuse the existing connection when the broker/auth/subscription config is identical.
    let existing_client = {
        let connections = state.connections.lock().await;
        connections
            .get(&request.tab_id)
            .filter(|connection| connection.config_key == config_key)
            .map(|connection| connection.client.clone())
    };

    let client = if let Some(client) = existing_client {
        client
    } else {
        if let Some(connection) = remove_connection(&state.connections, &request.tab_id).await {
            let _ = connection.client.disconnect().await;
            connection.poll_handle.abort();
        }

        match establish_connection(
            app.clone(),
            state.connections.clone(),
            &request,
            host,
            port,
            use_tls,
            config_key,
        )
        .await
        {
            Ok(client) => client,
            Err(error) => {
                emit_event(
                    &app,
                    MqttEventPayload {
                        tab_id: request.tab_id.clone(),
                        event_type: "error".to_string(),
                        broker: request.broker.clone(),
                        topic: None,
                        message: Some(error.clone()),
                        qos: None,
                    },
                );
                return Err(error);
            }
        }
    };

    if let Some(topic) = request
        .subscribe_topic
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        let qos = qos_from_u8(request.qos.unwrap_or(0));
        if let Err(error) = client.subscribe(topic.trim(), qos).await {
            let message = format!("Failed to subscribe to '{}': {}", topic.trim(), error);
            emit_event(
                &app,
                MqttEventPayload {
                    tab_id: request.tab_id.clone(),
                    event_type: "error".to_string(),
                    broker: request.broker.clone(),
                    topic: Some(topic.trim().to_string()),
                    message: Some(message.clone()),
                    qos: None,
                },
            );
            return Err(message);
        }
    }

    Ok(MqttCommandResponse { success: true })
}

#[tauri::command]
pub async fn mqtt_publish(
    app: AppHandle,
    state: State<'_, MqttState>,
    request: MqttPublishRequest,
) -> Result<MqttCommandResponse, String> {
    if request.topic.trim().is_empty() {
        return Err("Publish topic is required".to_string());
    }

    let client = {
        let connections = state.connections.lock().await;
        connections
            .get(&request.tab_id)
            .map(|connection| connection.client.clone())
    };

    let client = client.ok_or_else(|| "Not connected to an MQTT broker".to_string())?;

    let qos = qos_from_u8(request.qos.unwrap_or(0));
    let payload = request.payload.unwrap_or_default();
    let retain = request.retain.unwrap_or(false);

    client
        .publish(request.topic.trim(), qos, retain, payload.into_bytes())
        .await
        .map_err(|error| {
            let message = format!("Failed to publish to '{}': {}", request.topic.trim(), error);
            emit_event(
                &app,
                MqttEventPayload {
                    tab_id: request.tab_id.clone(),
                    event_type: "error".to_string(),
                    broker: String::new(),
                    topic: Some(request.topic.trim().to_string()),
                    message: Some(message.clone()),
                    qos: None,
                },
            );
            message
        })?;

    Ok(MqttCommandResponse { success: true })
}

#[tauri::command]
pub async fn mqtt_close(
    state: State<'_, MqttState>,
    tab_id: String,
) -> Result<MqttCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    if let Some(connection) = remove_connection(&state.connections, &tab_id).await {
        let _ = connection.client.disconnect().await;
        connection.poll_handle.abort();
    }

    Ok(MqttCommandResponse { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_mqtt_with_explicit_port() {
        assert_eq!(
            parse_broker("mqtt://broker.example.com:1884").unwrap(),
            ("broker.example.com".to_string(), 1884, false)
        );
    }

    #[test]
    fn defaults_port_per_scheme() {
        assert_eq!(
            parse_broker("mqtt://localhost").unwrap(),
            ("localhost".to_string(), 1883, false)
        );
        assert_eq!(
            parse_broker("mqtts://localhost").unwrap(),
            ("localhost".to_string(), 8883, true)
        );
    }

    #[test]
    fn treats_bare_authority_as_plaintext_mqtt() {
        assert_eq!(
            parse_broker("localhost:1883").unwrap(),
            ("localhost".to_string(), 1883, false)
        );
    }

    #[test]
    fn strips_trailing_path() {
        assert_eq!(
            parse_broker("mqtts://broker:8883/mqtt").unwrap(),
            ("broker".to_string(), 8883, true)
        );
    }

    #[test]
    fn rejects_empty_invalid_port_and_unknown_scheme() {
        assert!(parse_broker("   ").is_err());
        assert!(parse_broker("mqtt://host:notaport").is_err());
        assert!(parse_broker("ftp://host:1883").is_err());
    }

    #[test]
    fn maps_qos_values() {
        assert_eq!(qos_from_u8(0), QoS::AtMostOnce);
        assert_eq!(qos_from_u8(1), QoS::AtLeastOnce);
        assert_eq!(qos_from_u8(2), QoS::ExactlyOnce);
        assert_eq!(qos_from_u8(9), QoS::AtMostOnce);
    }
}
