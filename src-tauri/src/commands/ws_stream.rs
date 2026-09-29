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
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;
use tokio_tungstenite::{
    client_async_tls_with_config, connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};

use super::api_request::ClientCertConfig;
use super::proxy::{ProxySettings, WsProxyAction};
use super::proxy_tunnel::connect_through_proxy;
use super::tab_sessions::{CommandAck, Session, TabSessions, require_tab_id};
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

/// A live socket. The entry is only ever removed by its own reader task, once
/// the socket has actually ended, so that task alone reports `close` for the
/// tab; a closing socket stays registered but is never reused.
pub(crate) struct WsConnection {
    sender: mpsc::UnboundedSender<WsCommand>,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
    closing: bool,
}

impl WsConnection {
    /// Ask the writer to send a close frame, at most once.
    fn begin_close(&mut self) {
        if !self.closing {
            let _ = self.sender.send(WsCommand::Close);
            self.closing = true;
        }
    }

    fn is_reusable_for(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        verify_ssl: bool,
        client_cert: &Option<ClientCertConfig>,
    ) -> bool {
        // The TLS material is part of the identity of the socket: reusing a
        // connection opened under different certificate settings would silently
        // ignore the change the user just made.
        !self.closing
            && !self.sender.is_closed()
            && self.url == url
            && self.headers == *headers
            && self.verify_ssl == verify_ssl
            && self.client_cert == *client_cert
    }
}

/// Registry of live sockets, keyed by tab id.
pub(crate) type WsConnections = TabSessions<WsConnection>;

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

/// Host and port to name in the `CONNECT` request. Tungstenite has already
/// validated the scheme, so the only defaulting needed is the port.
fn target_authority(
    uri: &tokio_tungstenite::tungstenite::http::Uri,
    is_secure: bool,
) -> Result<(String, u16), String> {
    let host = uri
        .host()
        .ok_or_else(|| "The URL has no host to tunnel to".to_string())?
        .to_string();
    let port = uri.port_u16().unwrap_or(if is_secure { 443 } else { 80 });
    Ok((host, port))
}

fn emit_event<R: Runtime>(app: &AppHandle<R>, channel: &WsChannel, payload: WsEventPayload) {
    let _ = app.emit(channel.event_name, payload);
}

#[allow(clippy::too_many_arguments)]
async fn establish_connection<R: Runtime>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: WsConnections,
    tab_id: String,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
    proxy: WsProxyAction,
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
    let is_secure = ws_uri_is_secure(request.uri());
    let connector = if is_secure {
        Some(build_ws_connector(verify_ssl, client_cert.as_ref())?)
    } else {
        None
    };

    // tokio-tungstenite dials the target itself and knows nothing about
    // proxies, so a tunnel has to be opened here and the handshake run over it.
    // Both arms hand their stream to the same generic pump, which keeps the
    // unproxied path on tungstenite's own connect.
    match proxy {
        WsProxyAction::Unsupported { proxy_type } => Err(format!(
            "A {} proxy is configured, which {} connections cannot use. \
             Switch the proxy to HTTP or HTTPS, or add this host to the bypass list.",
            proxy_type.to_uppercase(),
            channel.request_label
        )),
        WsProxyAction::Direct => {
            let (stream, _) = connect_async_tls_with_config(request, None, false, connector)
                .await
                .map_err(|error| format!("Failed to connect: {}", error))?;
            Ok(spawn_pumps(
                app,
                channel,
                connections,
                tab_id,
                url,
                headers,
                verify_ssl,
                client_cert,
                stream,
            )
            .await)
        }
        WsProxyAction::Tunnel(endpoint) => {
            let (host, port) = target_authority(request.uri(), is_secure)?;
            let tunnel = connect_through_proxy(&endpoint, &host, port).await?;
            let (stream, _) = client_async_tls_with_config(request, tunnel, None, connector)
                .await
                .map_err(|error| format!("Failed to connect through proxy: {}", error))?;
            Ok(spawn_pumps(
                app,
                channel,
                connections,
                tab_id,
                url,
                headers,
                verify_ssl,
                client_cert,
                stream,
            )
            .await)
        }
    }
}

/// Register the connection, announce it, and start the writer/reader tasks.
///
/// Generic over the transport so the proxied and unproxied paths share it: the
/// former is tunnelled through a boxed stream, the latter is whatever
/// tungstenite dialled.
#[allow(clippy::too_many_arguments)]
async fn spawn_pumps<R: Runtime, S>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: WsConnections,
    tab_id: String,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
    stream: tokio_tungstenite::WebSocketStream<S>,
) -> mpsc::UnboundedSender<WsCommand>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (mut writer, mut reader) = stream.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<WsCommand>();
    let generation = connections.next_generation();

    connections.lock().await.insert(
        tab_id.clone(),
        Session {
            generation,
            value: WsConnection {
                sender: sender.clone(),
                url: url.clone(),
                headers,
                verify_ssl,
                client_cert,
                closing: false,
            },
        },
    );

    emit_event(&app, channel, WsEventPayload::open(&tab_id, &url));

    let write_app = app.clone();
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
    });

    let read_app = app.clone();
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

        // A socket replaced by a reconnect on this tab stays silent, so its
        // late `close` cannot tear down the successor in the UI.
        if connections
            .remove_if_current(&tab_id, generation)
            .await
            .is_some()
        {
            let payload = close_payload.unwrap_or_else(|| {
                WsEventPayload::close(
                    &tab_id,
                    &url,
                    Some(1000),
                    Some("Connection closed".to_string()),
                )
            });
            emit_event(&read_app, channel, payload);
        }
    });

    sender
}

#[allow(clippy::too_many_arguments)]
async fn get_or_create_connection<R: Runtime>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: &WsConnections,
    tab_id: &str,
    url: &str,
    headers: &HashMap<String, String>,
    verify_ssl: bool,
    client_cert: &Option<ClientCertConfig>,
    proxy: WsProxyAction,
) -> Result<mpsc::UnboundedSender<WsCommand>, String> {
    {
        let mut guard = connections.lock().await;
        if let Some(session) = guard.get_mut(tab_id) {
            let connection = &mut session.value;
            if connection.is_reusable_for(url, headers, verify_ssl, client_cert) {
                return Ok(connection.sender.clone());
            }
            connection.begin_close();
        }
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
        proxy,
    )
    .await
}

/// Connect-or-reuse, then send `request.message` if it is non-empty.
pub(crate) async fn send<R: Runtime>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: &WsConnections,
    proxy_settings: &ProxySettings,
    request: WsSendRequest,
) -> Result<CommandAck, String> {
    require_tab_id(&request.tab_id)?;

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
        proxy_settings.ws_proxy_action(&request.url),
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

    Ok(CommandAck::ok())
}

/// Ask the tab's writer task to close. The entry stays until the reader sees
/// the socket end, which is what lets it emit the terminal `close`.
pub(crate) async fn close(
    connections: &WsConnections,
    tab_id: String,
) -> Result<CommandAck, String> {
    require_tab_id(&tab_id)?;

    if let Some(session) = connections.lock().await.get_mut(&tab_id) {
        session.value.begin_close();
    }

    Ok(CommandAck::ok())
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

    /// Replacing a tab's socket (here: new headers) must not let the old
    /// socket's late close reach the tab, while a user close still reports.
    #[tokio::test]
    async fn a_reconnect_on_the_same_tab_does_not_close_its_successor() {
        use super::super::websocket::WEBSOCKET_CHANNEL;
        use std::time::Duration;
        use tauri::Listener;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (ended_tx, mut ended) = mpsc::unbounded_channel::<()>();
        tokio::spawn(async move {
            let mut accepted = 0;
            while let Ok((tcp, _)) = listener.accept().await {
                accepted += 1;
                let slow_close = accepted == 1;
                let ended_tx = ended_tx.clone();
                tokio::spawn(async move {
                    let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
                    while let Some(Ok(message)) = socket.next().await {
                        if slow_close && message.is_close() {
                            tokio::time::sleep(Duration::from_millis(300)).await;
                        }
                    }
                    let _ = ended_tx.send(());
                });
            }
        });

        let app = tauri::test::mock_app();
        let (event_tx, mut events) = mpsc::unbounded_channel::<String>();
        app.listen(WEBSOCKET_CHANNEL.event_name, move |event| {
            let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            let _ = event_tx.send(payload["eventType"].as_str().unwrap().to_string());
        });

        let connections = WsConnections::default();
        let proxy = ProxySettings::default();
        let request = |auth: &str| WsSendRequest {
            tab_id: "tab-1".to_string(),
            url: format!("ws://{addr}/socket"),
            headers: Some(HashMap::from([("X-Auth".to_string(), auth.to_string())])),
            message: None,
            verify_ssl: None,
            client_cert: None,
        };
        let settle = || tokio::time::sleep(Duration::from_millis(200));

        send(
            app.handle().clone(),
            &WEBSOCKET_CHANNEL,
            &connections,
            &proxy,
            request("a"),
        )
        .await
        .unwrap();
        send(
            app.handle().clone(),
            &WEBSOCKET_CHANNEL,
            &connections,
            &proxy,
            request("b"),
        )
        .await
        .unwrap();
        ended.recv().await.unwrap();
        settle().await;
        assert_eq!(connections.lock().await.len(), 1);

        close(&connections, "tab-1".to_string()).await.unwrap();
        ended.recv().await.unwrap();
        settle().await;

        let mut seen = Vec::new();
        while let Ok(event_type) = events.try_recv() {
            seen.push(event_type);
        }
        assert_eq!(seen, ["open", "open", "close"]);
        assert!(connections.lock().await.is_empty());
    }
}
