use super::api_request::ClientCertConfig;
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

/// TLS options for `mqtts://` connections. The client identity (mTLS) and
/// custom CA trust are resolved by the frontend from the per-host certificate
/// store — same shape and wire names as the HTTP and gRPC paths.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttTlsOptions {
    #[serde(default)]
    pub skip_verify: bool,
    #[serde(default)]
    pub client_cert: Option<ClientCertConfig>,
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
    #[serde(default)]
    pub tls: MqttTlsOptions,
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

/// Build the rumqttc TLS transport from the request's TLS options. Always
/// builds an explicit rustls config (webpki roots) rather than rumqttc's
/// default, so skip-verify, custom CA, and mTLS all flow through the shared
/// tls.rs builders. No ALPN is set (MQTT is not h2).
fn build_tls_transport(tls: &MqttTlsOptions) -> Result<Transport, String> {
    let (cert_path, key_path, ca_path) = match tls.client_cert.as_ref() {
        Some(cert) => (&cert.cert_path, &cert.key_path, &cert.ca_path),
        None => (&None, &None, &None),
    };

    let identity = crate::commands::tls::load_identity_pems(cert_path, key_path)?;

    let config = if tls.skip_verify {
        crate::commands::tls::build_danger_tls_config(identity)?
    } else {
        let ca_pem = crate::commands::tls::load_ca_pem(ca_path)?;
        crate::commands::tls::build_verifying_tls_config(ca_pem, identity)?
    };

    Ok(Transport::tls_with_config(config.into()))
}

fn build_config_key(request: &MqttConnectRequest, host: &str, port: u16, use_tls: bool) -> String {
    let (cert_path, key_path, ca_path) = match request.tls.client_cert.as_ref() {
        Some(cert) => (
            cert.cert_path.clone().unwrap_or_default(),
            cert.key_path.clone().unwrap_or_default(),
            cert.ca_path.clone().unwrap_or_default(),
        ),
        None => (String::new(), String::new(), String::new()),
    };
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        host,
        port,
        use_tls,
        request.client_id.clone().unwrap_or_default(),
        request.username.clone().unwrap_or_default(),
        request.password.clone().unwrap_or_default(),
        request.keep_alive.unwrap_or(60),
        request.subscribe_topic.clone().unwrap_or_default(),
        request.tls.skip_verify,
        cert_path,
        key_path,
        ca_path,
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
        mqtt_options.set_transport(build_tls_transport(&request.tls)?);
    }

    let (client, mut eventloop) = AsyncClient::new(mqtt_options, 10);

    // Hold the map lock across spawn + insert so the poll task's cleanup
    // (remove_connection) cannot run before the entry exists. An instantly
    // failing event loop parks on this lock and then removes the entry
    // inserted below, instead of racing ahead of the insert and leaving a
    // dead connection in the map.
    let mut connections = state.lock().await;

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

    connections.insert(
        request.tab_id.clone(),
        MqttConnection {
            client: client.clone(),
            poll_handle,
            config_key,
        },
    );
    drop(connections);

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
            .filter(|connection| {
                connection.config_key == config_key && !connection.poll_handle.is_finished()
            })
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

    fn base_request() -> MqttConnectRequest {
        MqttConnectRequest {
            tab_id: "tab".to_string(),
            broker: "mqtts://broker:8883".to_string(),
            client_id: None,
            username: None,
            password: None,
            keep_alive: None,
            subscribe_topic: None,
            qos: None,
            tls: MqttTlsOptions::default(),
        }
    }

    fn cert_config(cert: &str, key: &str, ca: &str) -> ClientCertConfig {
        serde_json::from_value(serde_json::json!({
            "certPath": cert,
            "keyPath": key,
            "caPath": ca,
        }))
        .unwrap()
    }

    #[test]
    fn config_key_changes_when_tls_options_change() {
        let base = base_request();
        let base_key = build_config_key(&base, "broker", 8883, true);
        assert_eq!(
            base_key,
            build_config_key(&base_request(), "broker", 8883, true)
        );

        let mut skip = base_request();
        skip.tls.skip_verify = true;
        assert_ne!(base_key, build_config_key(&skip, "broker", 8883, true));

        let mut with_cert = base_request();
        with_cert.tls.client_cert = Some(cert_config("/c.pem", "/k.pem", ""));
        let cert_key = build_config_key(&with_cert, "broker", 8883, true);
        assert_ne!(base_key, cert_key);

        let mut with_ca = base_request();
        with_ca.tls.client_cert = Some(cert_config("/c.pem", "/k.pem", "/ca.pem"));
        assert_ne!(cert_key, build_config_key(&with_ca, "broker", 8883, true));
    }

    #[test]
    fn config_key_treats_empty_client_cert_as_absent() {
        let mut empty_cert = base_request();
        empty_cert.tls.client_cert = Some(cert_config("", "", ""));
        assert_eq!(
            build_config_key(&base_request(), "broker", 8883, true),
            build_config_key(&empty_cert, "broker", 8883, true)
        );
    }

    #[test]
    fn connect_request_deserializes_without_tls() {
        let request: MqttConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab",
            "broker": "mqtt://localhost"
        }))
        .unwrap();
        assert!(!request.tls.skip_verify);
        assert!(request.tls.client_cert.is_none());
    }

    #[test]
    fn connect_request_deserializes_camel_case_tls() {
        let request: MqttConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab",
            "broker": "mqtts://localhost",
            "tls": {
                "skipVerify": true,
                "clientCert": { "certPath": "/c", "keyPath": "/k", "caPath": "/ca" }
            }
        }))
        .unwrap();
        assert!(request.tls.skip_verify);
        let cert = request.tls.client_cert.unwrap();
        assert_eq!(cert.cert_path.as_deref(), Some("/c"));
        assert_eq!(cert.key_path.as_deref(), Some("/k"));
        assert_eq!(cert.ca_path.as_deref(), Some("/ca"));
    }

    #[test]
    fn tls_transport_reports_missing_files() {
        let tls = MqttTlsOptions {
            skip_verify: false,
            client_cert: Some(cert_config("/nonexistent/c.pem", "/nonexistent/k.pem", "")),
        };
        let err = build_tls_transport(&tls).err().expect("expected an error");
        assert!(err.contains("could not be read"));
    }

    #[test]
    fn tls_transport_builds_for_skip_verify_without_cert() {
        let tls = MqttTlsOptions {
            skip_verify: true,
            client_cert: None,
        };
        assert!(build_tls_transport(&tls).is_ok());
    }
}
