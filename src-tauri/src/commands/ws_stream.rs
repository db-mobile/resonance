//! Shared machinery for the two WebSocket-backed transports: the raw WebSocket
//! client and the `graphql-transport-ws` subscription client.
//!
//! The two differ only in the Tauri event they emit on, whether they advertise
//! a subprotocol, and the wording of a handful of user-facing errors. Everything
//! else — connection registry, reuse policy, the writer/reader task pair, and
//! the event payload shape — is identical and lives here, so a fix to the socket
//! lifecycle lands on both transports at once.
//!
//! Each transport supplies a [`WsChannel`] describing its differences and owns
//! its own `#[tauri::command]` wrappers and managed state; the payload wire
//! format is shared, so the frontend contract is per-event-name only.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};

use super::api_request::ClientCertConfig;
use super::tls::{build_ws_connector, ws_uri_is_secure};

/// Everything that differs between the two transports. All fields are static:
/// a channel is a constant per transport, not per request.
pub(crate) struct WsChannel {
    /// Tauri event name the payloads are emitted on.
    pub event_name: &'static str,
    /// Advertised in `Sec-WebSocket-Protocol`, when the transport needs one.
    pub subprotocol: Option<&'static str>,
    /// Names the transport when a request cannot be built
    /// ("Failed to build {} request").
    pub request_label: &'static str,
    /// Qualifies header validation errors ("Invalid {}header name"). The
    /// WebSocket transport names itself here; the subscription one does not.
    pub header_error_qualifier: &'static str,
    /// Reported when the caller supplies no URL.
    pub url_required_error: &'static str,
    /// Reported when the writer task can no longer be reached.
    pub send_failed_error: &'static str,
}

pub(crate) enum WsCommand {
    Send(String),
    Close,
}

#[derive(Clone)]
pub(crate) struct WsConnection {
    sender: mpsc::UnboundedSender<WsCommand>,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
}

/// Registry of live sockets, keyed by tab id.
pub(crate) type WsConnections = Arc<Mutex<HashMap<String, WsConnection>>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsSendRequest {
    pub tab_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub message: Option<String>,
    /// Mirrors the HTTP and SSE request options: `Some(false)` turns
    /// certificate verification off, and the client certificate / custom CA are
    /// resolved per host by the frontend from the certificate store. Both only
    /// apply to `wss://` URLs.
    #[serde(default)]
    pub verify_ssl: Option<bool>,
    #[serde(default)]
    pub client_cert: Option<ClientCertConfig>,
}

#[derive(Debug, Serialize)]
pub struct WsCommandResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WsEventPayload {
    tab_id: String,
    event_type: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl WsEventPayload {
    fn new(tab_id: &str, url: &str, event_type: &str) -> Self {
        Self {
            tab_id: tab_id.to_string(),
            event_type: event_type.to_string(),
            url: url.to_string(),
            message: None,
            code: None,
            reason: None,
        }
    }

    fn open(tab_id: &str, url: &str) -> Self {
        Self {
            code: Some(101),
            reason: Some("Switching Protocols".to_string()),
            ..Self::new(tab_id, url, "open")
        }
    }

    fn message(tab_id: &str, url: &str, message: String) -> Self {
        Self {
            message: Some(message),
            ..Self::new(tab_id, url, "message")
        }
    }

    fn error(tab_id: &str, url: &str, message: String) -> Self {
        Self {
            message: Some(message),
            ..Self::new(tab_id, url, "error")
        }
    }

    fn close(tab_id: &str, url: &str, code: Option<u16>, reason: Option<String>) -> Self {
        Self {
            code,
            reason,
            ..Self::new(tab_id, url, "close")
        }
    }
}

fn emit_event(app: &AppHandle, channel: &WsChannel, payload: WsEventPayload) {
    let _ = app.emit(channel.event_name, payload);
}

async fn remove_connection_if_current(connections: &WsConnections, tab_id: &str, url: &str) {
    let mut connections = connections.lock().await;
    if matches!(connections.get(tab_id), Some(connection) if connection.url == url) {
        connections.remove(tab_id);
    }
}

#[allow(clippy::too_many_arguments)]
async fn establish_connection(
    app: AppHandle,
    channel: &'static WsChannel,
    connections: WsConnections,
    tab_id: String,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
) -> Result<mpsc::UnboundedSender<WsCommand>, String> {
    let mut request = url.clone().into_client_request().map_err(|error| {
        format!(
            "Failed to build {} request: {}",
            channel.request_label, error
        )
    })?;
    for (key, value) in &headers {
        let header_name = key
            .parse::<tokio_tungstenite::tungstenite::http::header::HeaderName>()
            .map_err(|error| {
                format!(
                    "Invalid {}header name '{}': {}",
                    channel.header_error_qualifier, key, error
                )
            })?;
        let header_value = value
            .parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
            .map_err(|error| {
                format!(
                    "Invalid {}header value for '{}': {}",
                    channel.header_error_qualifier, key, error
                )
            })?;
        request.headers_mut().insert(header_name, header_value);
    }
    if let Some(subprotocol) = channel.subprotocol {
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            tokio_tungstenite::tungstenite::http::HeaderValue::from_static(subprotocol),
        );
    }

    // Only `wss://` needs a TLS connector. Building one for a plaintext socket
    // would let a stale certificate path break a connection that never uses it.
    let connector = if ws_uri_is_secure(request.uri()) {
        Some(build_ws_connector(verify_ssl, client_cert.as_ref())?)
    } else {
        None
    };

    let (stream, _) = connect_async_tls_with_config(request, None, false, connector)
        .await
        .map_err(|error| format!("Failed to connect: {}", error))?;

    let (mut writer, mut reader) = stream.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<WsCommand>();

    {
        let mut guard = connections.lock().await;
        guard.insert(
            tab_id.clone(),
            WsConnection {
                sender: sender.clone(),
                url: url.clone(),
                headers: headers.clone(),
                verify_ssl,
                client_cert: client_cert.clone(),
            },
        );
    }

    emit_event(&app, channel, WsEventPayload::open(&tab_id, &url));

    let write_app = app.clone();
    let write_connections = connections.clone();
    let write_tab_id = tab_id.clone();
    let write_url = url.clone();
    tokio::spawn(async move {
        while let Some(command) = receiver.recv().await {
            match command {
                WsCommand::Send(message) => {
                    if let Err(error) = writer.send(Message::Text(message)).await {
                        emit_event(
                            &write_app,
                            channel,
                            WsEventPayload::error(&write_tab_id, &write_url, error.to_string()),
                        );
                        break;
                    }
                }
                WsCommand::Close => {
                    let _ = writer.send(Message::Close(None)).await;
                    break;
                }
            }
        }

        remove_connection_if_current(&write_connections, &write_tab_id, &write_url).await;
    });

    let read_app = app.clone();
    let read_connections = connections.clone();
    tokio::spawn(async move {
        let mut close_payload = None;

        while let Some(message) = reader.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    emit_event(
                        &read_app,
                        channel,
                        WsEventPayload::message(&tab_id, &url, text.to_string()),
                    );
                }
                Ok(Message::Binary(bytes)) => {
                    emit_event(
                        &read_app,
                        channel,
                        WsEventPayload::message(
                            &tab_id,
                            &url,
                            format!("[Binary message received: {} bytes]", bytes.len()),
                        ),
                    );
                }
                Ok(Message::Close(frame)) => {
                    close_payload = Some(WsEventPayload::close(
                        &tab_id,
                        &url,
                        frame.as_ref().map(|value| value.code.into()),
                        frame.as_ref().map(|value| value.reason.to_string()),
                    ));
                    break;
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                Err(error) => {
                    emit_event(
                        &read_app,
                        channel,
                        WsEventPayload::error(&tab_id, &url, error.to_string()),
                    );
                    break;
                }
            }
        }

        if let Some(payload) = close_payload {
            emit_event(&read_app, channel, payload);
        } else {
            emit_event(
                &read_app,
                channel,
                WsEventPayload::close(
                    &tab_id,
                    &url,
                    Some(1000),
                    Some("Connection closed".to_string()),
                ),
            );
        }

        remove_connection_if_current(&read_connections, &tab_id, &url).await;
    });

    Ok(sender)
}

#[allow(clippy::too_many_arguments)]
async fn get_or_create_connection(
    app: AppHandle,
    channel: &'static WsChannel,
    connections: &WsConnections,
    tab_id: &str,
    url: &str,
    headers: &HashMap<String, String>,
    verify_ssl: bool,
    client_cert: &Option<ClientCertConfig>,
) -> Result<mpsc::UnboundedSender<WsCommand>, String> {
    let existing = {
        let guard = connections.lock().await;
        guard.get(tab_id).cloned()
    };

    if let Some(connection) = existing {
        // The TLS material is part of the identity of the socket: reusing a
        // connection opened under different certificate settings would silently
        // ignore the change the user just made.
        if connection.url == url
            && connection.headers == *headers
            && connection.verify_ssl == verify_ssl
            && connection.client_cert == *client_cert
        {
            return Ok(connection.sender);
        }

        let _ = connection.sender.send(WsCommand::Close);
        let mut guard = connections.lock().await;
        guard.remove(tab_id);
    }

    establish_connection(
        app,
        channel,
        connections.clone(),
        tab_id.to_string(),
        url.to_string(),
        headers.clone(),
        verify_ssl,
        client_cert.clone(),
    )
    .await
}

/// Connect-or-reuse, then send `request.message` if it is non-empty.
pub(crate) async fn send(
    app: AppHandle,
    channel: &'static WsChannel,
    connections: &WsConnections,
    request: WsSendRequest,
) -> Result<WsCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    if request.url.trim().is_empty() {
        return Err(channel.url_required_error.to_string());
    }

    let message = request.message.unwrap_or_default();
    let headers = request.headers.unwrap_or_default();
    let verify_ssl = request.verify_ssl != Some(false);

    let sender = match get_or_create_connection(
        app.clone(),
        channel,
        connections,
        &request.tab_id,
        &request.url,
        &headers,
        verify_ssl,
        &request.client_cert,
    )
    .await
    {
        Ok(sender) => sender,
        Err(error) => {
            emit_event(
                &app,
                channel,
                WsEventPayload::error(&request.tab_id, &request.url, error.clone()),
            );
            return Err(error);
        }
    };

    if !message.is_empty() {
        sender
            .send(WsCommand::Send(message))
            .map_err(|_| channel.send_failed_error.to_string())?;
    }

    Ok(WsCommandResponse { success: true })
}

/// Drop the tab's connection from the registry and ask its writer task to close.
pub(crate) async fn close(
    connections: &WsConnections,
    tab_id: String,
) -> Result<WsCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    let connection = {
        let mut guard = connections.lock().await;
        guard.remove(&tab_id)
    };

    if let Some(connection) = connection {
        let _ = connection.sender.send(WsCommand::Close);
    }

    Ok(WsCommandResponse { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_a_send_request_with_tls_options() {
        let request: WsSendRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "wss://example.com/socket",
            "headers": { "Authorization": "Bearer t" },
            "message": "ping",
            "verifySsl": false,
            "clientCert": {
                "certPath": "/certs/client.crt",
                "keyPath": "/certs/client.key",
                "caPath": "/certs/ca.pem"
            }
        }))
        .expect("expected the request to deserialize");

        assert_eq!(request.verify_ssl, Some(false));
        let cert = request.client_cert.expect("expected a client cert");
        assert_eq!(cert.cert_path.as_deref(), Some("/certs/client.crt"));
        assert_eq!(cert.ca_path.as_deref(), Some("/certs/ca.pem"));
    }

    /// A payload from before the TLS fields existed must still deserialize, and
    /// an absent `verifySsl` has to mean verification stays on.
    #[test]
    fn a_request_without_tls_options_verifies_by_default() {
        let request: WsSendRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "wss://example.com/socket"
        }))
        .expect("expected the request to deserialize");

        assert_eq!(request.verify_ssl, None);
        assert!(request.client_cert.is_none());
        assert!(request.verify_ssl != Some(false));
    }

    #[test]
    fn only_a_secure_url_takes_the_connector_path() {
        let secure = "wss://example.com/socket"
            .to_string()
            .into_client_request()
            .unwrap();
        let plain = "ws://example.com/socket"
            .to_string()
            .into_client_request()
            .unwrap();

        assert!(ws_uri_is_secure(secure.uri()));
        assert!(!ws_uri_is_secure(plain.uri()));
    }

    /// The frontend listens per event name, and only the subscription transport
    /// may advertise a subprotocol — guard both against an accidental swap.
    #[test]
    fn the_two_channels_keep_their_distinct_wire_identities() {
        use super::super::graphql_subscription::SUBSCRIPTION_CHANNEL;
        use super::super::websocket::WEBSOCKET_CHANNEL;

        assert_eq!(WEBSOCKET_CHANNEL.event_name, "websocket-event");
        assert_eq!(
            SUBSCRIPTION_CHANNEL.event_name,
            "graphql-subscription-event"
        );
        assert_eq!(WEBSOCKET_CHANNEL.subprotocol, None);
        assert_eq!(
            SUBSCRIPTION_CHANNEL.subprotocol,
            Some("graphql-transport-ws")
        );
    }

    /// These strings reach the user, and each transport words them slightly
    /// differently. Pin the composed forms so parameterising them cannot
    /// quietly reword one.
    #[test]
    fn each_channel_composes_its_own_error_wording() {
        use super::super::graphql_subscription::SUBSCRIPTION_CHANNEL;
        use super::super::websocket::WEBSOCKET_CHANNEL;

        let compose = |channel: &WsChannel| {
            (
                format!("Failed to build {} request: boom", channel.request_label),
                format!(
                    "Invalid {}header name 'X': boom",
                    channel.header_error_qualifier
                ),
                format!(
                    "Invalid {}header value for 'X': boom",
                    channel.header_error_qualifier
                ),
                channel.url_required_error,
                channel.send_failed_error,
            )
        };

        assert_eq!(
            compose(&WEBSOCKET_CHANNEL),
            (
                "Failed to build WebSocket request: boom".to_string(),
                "Invalid WebSocket header name 'X': boom".to_string(),
                "Invalid WebSocket header value for 'X': boom".to_string(),
                "WebSocket URL is required",
                "Failed to send WebSocket message",
            )
        );
        assert_eq!(
            compose(&SUBSCRIPTION_CHANNEL),
            (
                "Failed to build subscription request: boom".to_string(),
                "Invalid header name 'X': boom".to_string(),
                "Invalid header value for 'X': boom".to_string(),
                "Subscription URL is required",
                "Failed to send subscription message",
            )
        );
    }

    #[test]
    fn an_event_payload_omits_absent_optional_fields() {
        let json = serde_json::to_value(WsEventPayload::message(
            "tab-1",
            "wss://example.com/socket",
            "hi".to_string(),
        ))
        .expect("payload serializes");

        assert_eq!(json["tabId"], "tab-1");
        assert_eq!(json["eventType"], "message");
        assert_eq!(json["message"], "hi");
        assert!(json.get("code").is_none());
        assert!(json.get("reason").is_none());
    }
}
