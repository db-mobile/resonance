use super::api_request::ClientCertConfig;
use super::tab_sessions::{CommandAck, Session, TabSessions, require_tab_id};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rumqttc::{AsyncClient, Event, LastWill, MqttOptions, Packet, QoS, Transport};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinHandle;

/// Maximum MQTT packet size (incoming and outgoing). rumqttc defaults to only
/// 10 KiB, which tears the connection down on any non-trivial JSON payload; a
/// testing client needs to handle realistically large messages. Bounded so a
/// rogue broker cannot force an unbounded per-packet allocation.
const MAX_MQTT_PACKET_SIZE: usize = 64 * 1024 * 1024;

const DEFAULT_KEEP_ALIVE_SECS: u64 = 60;

/// The CONNECT packet carries keep-alive as a u16 number of seconds.
const MAX_KEEP_ALIVE_SECS: u64 = u16::MAX as u64;

/// Build the base MQTT options (identity, keep-alive, packet size). Credentials
/// and TLS transport are layered on by the caller.
fn base_mqtt_options(
    client_id: String,
    host: String,
    port: u16,
    keep_alive_secs: u64,
) -> MqttOptions {
    let mut options = MqttOptions::new(client_id, host, port);
    options.set_keep_alive(Duration::from_secs(keep_alive_secs));
    options.set_max_packet_size(MAX_MQTT_PACKET_SIZE, MAX_MQTT_PACKET_SIZE);
    options
}

struct MqttConnection {
    client: AsyncClient,
    poll_handle: JoinHandle<()>,
    config_key: String,
    /// Kept so failures raised outside the connect path — a publish error, say —
    /// can still name the broker in their event.
    broker: String,
}

impl MqttConnection {
    async fn shutdown(self) {
        let _ = self.client.disconnect().await;
        self.poll_handle.abort();
    }
}

#[derive(Default)]
pub struct MqttState {
    connections: TabSessions<MqttConnection>,
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
    pub clean_session: Option<bool>,
    #[serde(default)]
    pub last_will: Option<MqttLastWill>,
    #[serde(default)]
    pub tls: MqttTlsOptions,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttLastWill {
    #[serde(default)]
    pub topic: String,
    #[serde(default)]
    pub payload: String,
    #[serde(default)]
    pub qos: u8,
    #[serde(default)]
    pub retain: bool,
}

impl MqttConnectRequest {
    fn keep_alive_secs(&self) -> u64 {
        self.keep_alive
            .unwrap_or(DEFAULT_KEEP_ALIVE_SECS)
            .min(MAX_KEEP_ALIVE_SECS)
    }

    fn clean_session(&self) -> bool {
        self.clean_session.unwrap_or(true)
    }

    /// A will without a topic is how the frontend says "no will".
    fn last_will(&self) -> Option<&MqttLastWill> {
        self.last_will
            .as_ref()
            .filter(|will| !will.topic.trim().is_empty())
    }
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
    /// `utf8` or `base64`; only set on message events.
    #[serde(skip_serializing_if = "Option::is_none")]
    encoding: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retain: Option<bool>,
}

impl MqttEventPayload {
    fn new(tab_id: &str, broker: &str, event_type: &str) -> Self {
        Self {
            tab_id: tab_id.to_string(),
            event_type: event_type.to_string(),
            broker: broker.to_string(),
            topic: None,
            message: None,
            qos: None,
            encoding: None,
            retain: None,
        }
    }

    fn connect(tab_id: &str, broker: &str) -> Self {
        Self::new(tab_id, broker, "connect")
    }

    fn disconnect(tab_id: &str, broker: &str) -> Self {
        Self::new(tab_id, broker, "disconnect")
    }

    fn message(
        tab_id: &str,
        broker: &str,
        topic: String,
        payload: &[u8],
        qos: u8,
        retain: bool,
    ) -> Self {
        let (body, encoding) = encode_payload(payload);
        Self {
            topic: Some(topic),
            message: Some(body),
            qos: Some(qos),
            encoding: Some(encoding),
            retain: Some(retain),
            ..Self::new(tab_id, broker, "message")
        }
    }

    fn error(tab_id: &str, broker: &str, message: String) -> Self {
        Self {
            message: Some(message),
            ..Self::new(tab_id, broker, "error")
        }
    }

    /// A failure that concerns one topic rather than the connection as a whole.
    fn error_on_topic(tab_id: &str, broker: &str, topic: String, message: String) -> Self {
        Self {
            topic: Some(topic),
            ..Self::error(tab_id, broker, message)
        }
    }
}

/// Text payloads pass through as-is; anything that is not valid UTF-8 is
/// base64-encoded so the bytes survive the trip to the frontend intact.
fn encode_payload(payload: &[u8]) -> (String, &'static str) {
    match std::str::from_utf8(payload) {
        Ok(text) => (text.to_string(), "utf8"),
        Err(_) => (BASE64_STANDARD.encode(payload), "base64"),
    }
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
    let config =
        crate::commands::tls::build_client_tls_config(!tls.skip_verify, tls.client_cert.as_ref())?;
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
    let will = request
        .last_will()
        .map(|will| {
            format!(
                "{}|{}|{}|{}",
                will.topic, will.payload, will.qos, will.retain
            )
        })
        .unwrap_or_default();
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        host,
        port,
        use_tls,
        request.client_id.clone().unwrap_or_default(),
        request.username.clone().unwrap_or_default(),
        request.password.clone().unwrap_or_default(),
        request.keep_alive_secs(),
        request.subscribe_topic.clone().unwrap_or_default(),
        request.tls.skip_verify,
        cert_path,
        key_path,
        ca_path,
        request.clean_session(),
        will,
    )
}

/// Build the full client options for a connect request: identity, session,
/// will, credentials and TLS transport.
fn build_mqtt_options(
    request: &MqttConnectRequest,
    host: String,
    port: u16,
    use_tls: bool,
) -> Result<MqttOptions, String> {
    let given_client_id = request.client_id.clone().filter(|id| !id.trim().is_empty());

    if !request.clean_session() && given_client_id.is_none() {
        return Err("A persistent session (clean session off) needs a fixed Client ID".to_string());
    }

    let client_id = given_client_id
        .unwrap_or_else(|| format!("resonance-{}", &uuid::Uuid::new_v4().to_string()[..8]));

    let mut mqtt_options = base_mqtt_options(client_id, host, port, request.keep_alive_secs());
    mqtt_options.set_clean_session(request.clean_session());

    if let Some(will) = request.last_will() {
        mqtt_options.set_last_will(LastWill::new(
            will.topic.trim(),
            will.payload.clone().into_bytes(),
            qos_from_u8(will.qos),
            will.retain,
        ));
    }

    if let Some(username) = request.username.as_ref().filter(|value| !value.is_empty()) {
        mqtt_options.set_credentials(username, request.password.clone().unwrap_or_default());
    }

    if use_tls {
        mqtt_options.set_transport(build_tls_transport(&request.tls)?);
    }

    Ok(mqtt_options)
}

async fn establish_connection(
    app: AppHandle,
    state: TabSessions<MqttConnection>,
    request: &MqttConnectRequest,
    host: String,
    port: u16,
    use_tls: bool,
    config_key: String,
) -> Result<AsyncClient, String> {
    let mqtt_options = build_mqtt_options(request, host, port, use_tls)?;

    let (client, mut eventloop) = AsyncClient::new(mqtt_options, 10);

    // Hold the map lock across spawn + insert so the poll task's cleanup
    // cannot run before the entry exists. An instantly failing event loop
    // parks on this lock and then removes the entry inserted below, instead
    // of racing ahead of the insert and leaving a dead connection in the map.
    let generation = state.next_generation();
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
                        MqttEventPayload::connect(&poll_tab_id, &poll_broker),
                    );
                }
                Ok(Event::Incoming(Packet::Publish(publish))) => {
                    emit_event(
                        &poll_app,
                        MqttEventPayload::message(
                            &poll_tab_id,
                            &poll_broker,
                            publish.topic.clone(),
                            &publish.payload,
                            publish.qos as u8,
                            publish.retain,
                        ),
                    );
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    break;
                }
                Ok(_) => {}
                Err(error) => {
                    emit_event(
                        &poll_app,
                        MqttEventPayload::error(&poll_tab_id, &poll_broker, error.to_string()),
                    );
                    break;
                }
            }
        }

        // Emit a single terminal disconnect when the loop ends (broker close or
        // error). On an explicit abort (user disconnect / tab close) this code does
        // not run — the frontend already handles UI cleanup in those paths. A
        // loop that was superseded by a reconnect on this tab stays silent.
        if poll_state
            .remove_if_current(&poll_tab_id, generation)
            .await
            .is_some()
        {
            emit_event(
                &poll_app,
                MqttEventPayload::disconnect(&poll_tab_id, &poll_broker),
            );
        }
    });

    connections.insert(
        request.tab_id.clone(),
        Session {
            generation,
            value: MqttConnection {
                client: client.clone(),
                poll_handle,
                config_key,
                broker: request.broker.clone(),
            },
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
) -> Result<CommandAck, String> {
    require_tab_id(&request.tab_id)?;

    let (host, port, use_tls) = match parse_broker(&request.broker) {
        Ok(parsed) => parsed,
        Err(error) => {
            emit_event(
                &app,
                MqttEventPayload::error(&request.tab_id, &request.broker, error.clone()),
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
            .map(|session| &session.value)
            .filter(|connection| {
                connection.config_key == config_key && !connection.poll_handle.is_finished()
            })
            .map(|connection| connection.client.clone())
    };

    let client = if let Some(client) = existing_client {
        client
    } else {
        let previous = state.connections.lock().await.remove(&request.tab_id);
        if let Some(previous) = previous {
            previous.value.shutdown().await;
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
                    MqttEventPayload::error(&request.tab_id, &request.broker, error.clone()),
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
                MqttEventPayload::error_on_topic(
                    &request.tab_id,
                    &request.broker,
                    topic.trim().to_string(),
                    message.clone(),
                ),
            );
            return Err(message);
        }
    }

    Ok(CommandAck::ok())
}

#[tauri::command]
pub async fn mqtt_publish(
    app: AppHandle,
    state: State<'_, MqttState>,
    request: MqttPublishRequest,
) -> Result<CommandAck, String> {
    if request.topic.trim().is_empty() {
        return Err("Publish topic is required".to_string());
    }

    let connection = {
        let connections = state.connections.lock().await;
        connections
            .get(&request.tab_id)
            .map(|session| (session.value.client.clone(), session.value.broker.clone()))
    };

    let (client, broker) =
        connection.ok_or_else(|| "Not connected to an MQTT broker".to_string())?;

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
                MqttEventPayload::error_on_topic(
                    &request.tab_id,
                    &broker,
                    request.topic.trim().to_string(),
                    message.clone(),
                ),
            );
            message
        })?;

    Ok(CommandAck::ok())
}

#[tauri::command]
pub async fn mqtt_close(state: State<'_, MqttState>, tab_id: String) -> Result<CommandAck, String> {
    require_tab_id(&tab_id)?;

    let connection = state.connections.lock().await.remove(&tab_id);
    if let Some(connection) = connection {
        connection.value.shutdown().await;
    }

    Ok(CommandAck::ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The payload is a frontend contract, so pin what each constructor emits
    /// and — just as importantly — what it leaves out.
    #[test]
    fn payload_constructors_emit_the_expected_wire_shapes() {
        let json = |payload: MqttEventPayload| serde_json::to_value(payload).unwrap();

        let connect = json(MqttEventPayload::connect("tab-1", "mqtt://broker:1883"));
        assert_eq!(connect["tabId"], "tab-1");
        assert_eq!(connect["eventType"], "connect");
        assert_eq!(connect["broker"], "mqtt://broker:1883");
        assert!(connect.get("topic").is_none());
        assert!(connect.get("message").is_none());
        assert!(connect.get("qos").is_none());
        assert!(connect.get("encoding").is_none());
        assert!(connect.get("retain").is_none());

        let message = json(MqttEventPayload::message(
            "tab-1",
            "mqtt://broker:1883",
            "sensors/temp".to_string(),
            b"21.5",
            1,
            true,
        ));
        assert_eq!(message["eventType"], "message");
        assert_eq!(message["topic"], "sensors/temp");
        assert_eq!(message["message"], "21.5");
        assert_eq!(message["qos"], 1);
        assert_eq!(message["encoding"], "utf8");
        assert_eq!(message["retain"], true);

        let error = json(MqttEventPayload::error(
            "tab-1",
            "mqtt://broker:1883",
            "boom".to_string(),
        ));
        assert_eq!(error["eventType"], "error");
        assert_eq!(error["message"], "boom");
        assert!(error.get("topic").is_none());
        assert!(error.get("encoding").is_none());

        let topic_error = json(MqttEventPayload::error_on_topic(
            "tab-1",
            "mqtt://broker:1883",
            "sensors/temp".to_string(),
            "boom".to_string(),
        ));
        assert_eq!(topic_error["eventType"], "error");
        assert_eq!(topic_error["topic"], "sensors/temp");
        assert_eq!(topic_error["message"], "boom");

        assert_eq!(
            json(MqttEventPayload::disconnect("tab-1", "mqtt://broker:1883"))["eventType"],
            "disconnect"
        );
    }

    #[test]
    fn base_options_raise_packet_size_above_default() {
        let options = base_mqtt_options("client".to_string(), "localhost".to_string(), 1883, 60);
        assert_eq!(options.max_packet_size(), MAX_MQTT_PACKET_SIZE);
        assert!(
            options.max_packet_size() > 10 * 1024,
            "must exceed rumqttc's 10 KiB default"
        );
    }

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
            clean_session: None,
            last_will: None,
            tls: MqttTlsOptions::default(),
        }
    }

    fn will(topic: &str) -> MqttLastWill {
        MqttLastWill {
            topic: topic.to_string(),
            payload: "offline".to_string(),
            qos: 1,
            retain: true,
        }
    }

    #[test]
    fn text_payloads_pass_through_and_binary_is_base64() {
        assert_eq!(
            encode_payload("grüß".as_bytes()),
            ("grüß".to_string(), "utf8")
        );
        assert_eq!(
            encode_payload(&[0xff, 0x00, 0xfe]),
            ("/wD+".to_string(), "base64")
        );
        assert_eq!(encode_payload(b""), (String::new(), "utf8"));
    }

    #[test]
    fn keep_alive_defaults_and_clamps_to_the_wire_limit() {
        let mut request = base_request();
        assert_eq!(request.keep_alive_secs(), 60);
        request.keep_alive = Some(0);
        assert_eq!(request.keep_alive_secs(), 0);
        request.keep_alive = Some(1_000_000);
        assert_eq!(request.keep_alive_secs(), 65535);
    }

    #[test]
    fn options_carry_session_and_will_settings() {
        let mut request = base_request();
        request.client_id = Some("fixed".to_string());
        request.clean_session = Some(false);
        request.last_will = Some(will("devices/1/status"));
        request.keep_alive = Some(5);

        let options = build_mqtt_options(&request, "broker".to_string(), 1883, false).unwrap();
        assert!(!options.clean_session());
        assert_eq!(options.keep_alive(), Duration::from_secs(5));
        let last_will = options.last_will().expect("will set");
        assert_eq!(last_will.topic, "devices/1/status");
        assert_eq!(&last_will.message[..], b"offline");
        assert_eq!(last_will.qos, QoS::AtLeastOnce);
        assert!(last_will.retain);
    }

    #[test]
    fn options_default_to_clean_session_without_will() {
        let options =
            build_mqtt_options(&base_request(), "broker".to_string(), 1883, false).unwrap();
        assert!(options.clean_session());
        assert!(options.last_will().is_none());
        assert!(options.client_id().starts_with("resonance-"));
    }

    #[test]
    fn a_will_with_a_blank_topic_is_no_will() {
        let mut request = base_request();
        request.last_will = Some(will("  "));
        let options = build_mqtt_options(&request, "broker".to_string(), 1883, false).unwrap();
        assert!(options.last_will().is_none());
    }

    #[test]
    fn persistent_session_without_client_id_is_rejected() {
        let mut request = base_request();
        request.clean_session = Some(false);
        request.client_id = Some("   ".to_string());
        let err = build_mqtt_options(&request, "broker".to_string(), 1883, false)
            .expect_err("expected an error");
        assert!(err.contains("Client ID"));
    }

    #[test]
    fn config_key_changes_when_session_or_will_changes() {
        let base_key = build_config_key(&base_request(), "broker", 8883, true);

        let mut persistent = base_request();
        persistent.clean_session = Some(false);
        assert_ne!(
            base_key,
            build_config_key(&persistent, "broker", 8883, true)
        );

        let mut with_will = base_request();
        with_will.last_will = Some(will("t/will"));
        let will_key = build_config_key(&with_will, "broker", 8883, true);
        assert_ne!(base_key, will_key);

        with_will.last_will.as_mut().unwrap().payload = "gone".to_string();
        assert_ne!(will_key, build_config_key(&with_will, "broker", 8883, true));

        let mut blank_will = base_request();
        blank_will.last_will = Some(will(""));
        assert_eq!(
            base_key,
            build_config_key(&blank_will, "broker", 8883, true)
        );
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
        assert!(request.clean_session());
        assert!(request.last_will().is_none());
    }

    #[test]
    fn connect_request_deserializes_camel_case_session_options() {
        let request: MqttConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab",
            "broker": "mqtt://localhost",
            "keepAlive": 30,
            "cleanSession": false,
            "lastWill": { "topic": "t/will", "payload": "bye", "qos": 2, "retain": true }
        }))
        .unwrap();
        assert_eq!(request.keep_alive_secs(), 30);
        assert!(!request.clean_session());
        let will = request.last_will().unwrap();
        assert_eq!(will.topic, "t/will");
        assert_eq!(will.payload, "bye");
        assert_eq!(will.qos, 2);
        assert!(will.retain);
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
