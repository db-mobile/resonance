//! Shared WebSocket lifecycle for raw sockets and GraphQL subscriptions.
use super::api_request::ClientCertConfig;
use super::proxy::{ProxySettings, WsProxyAction};
use super::proxy_tunnel::connect_through_proxy;
use super::tab_sessions::{CommandAck, Session, TabSessions, require_tab_id};
use super::tls::{build_ws_connector, ws_uri_is_secure};
use futures_util::{Sink, SinkExt, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::{
    client_async_tls_with_config, connect_async_tls_with_config,
    tungstenite::{
        Error as WsError,
        client::IntoClientRequest,
        protocol::{CloseFrame, Message, frame::coding::CloseCode},
    },
};

const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) struct WsChannel {
    pub event_name: &'static str,
    pub subprotocol: Option<&'static str>,
    pub request_label: &'static str,
    pub header_error_qualifier: &'static str,
    pub url_required_error: &'static str,
    pub send_failed_error: &'static str,
}

pub(crate) enum WsCommand {
    Send(String),
    Close,
    Flush,
}

pub(crate) struct WsConnection {
    sender: mpsc::UnboundedSender<WsCommand>,
    shutdown: watch::Sender<bool>,
    connection_id: Option<String>,
    url: String,
    headers: HashMap<String, String>,
    protocols: Vec<String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
    open: bool,
    closing: bool,
}
impl WsConnection {
    fn begin_close(&mut self) {
        self.closing = true;
        self.shutdown.send_replace(true);
    }
    fn is_reusable_for(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        protocols: &[String],
        verify_ssl: bool,
        client_cert: &Option<ClientCertConfig>,
    ) -> bool {
        self.open
            && !self.closing
            && !self.sender.is_closed()
            && self.url == url
            && self.headers == *headers
            && self.protocols == protocols
            && self.verify_ssl == verify_ssl
            && self.client_cert == *client_cert
    }
}
pub(crate) type WsConnections = TabSessions<WsConnection>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsSendRequest {
    pub tab_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    /// Sub-protocols offered in `Sec-WebSocket-Protocol`, in preference order.
    #[serde(default)]
    pub protocols: Option<Vec<String>>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub verify_ssl: Option<bool>,
    #[serde(default)]
    pub client_cert: Option<ClientCertConfig>,
}
fn default_connect_timeout() -> Option<u64> {
    Some(30_000)
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsConnectRequest {
    #[serde(flatten)]
    pub options: WsSendRequest,
    pub connection_id: String,
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_ms: Option<u64>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMessageRequest {
    pub tab_id: String,
    pub connection_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WsEventPayload {
    tab_id: String,
    event_type: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    /// The sub-protocol the server selected during the handshake.
    #[serde(skip_serializing_if = "Option::is_none")]
    protocol: Option<String>,
}
impl WsEventPayload {
    fn new(tab_id: &str, url: &str, event_type: &str) -> Self {
        Self {
            tab_id: tab_id.into(),
            url: url.into(),
            event_type: event_type.into(),
            connection_id: None,
            message: None,
            code: None,
            reason: None,
            protocol: None,
        }
    }
    fn open(tab_id: &str, url: &str, protocol: Option<String>) -> Self {
        Self {
            code: Some(101),
            reason: Some("Switching Protocols".into()),
            protocol,
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
fn emit_event<R: Runtime>(app: &AppHandle<R>, channel: &WsChannel, payload: WsEventPayload) {
    let _ = app.emit(channel.event_name, payload);
}

/// Owns one generation. Check and emit under the same lock so superseded tasks stay silent.
struct Lifecycle<R: Runtime> {
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: WsConnections,
    tab_id: String,
    url: String,
    connection_id: Option<String>,
    generation: u64,
}
impl<R: Runtime> Lifecycle<R> {
    async fn emit(&self, mut payload: WsEventPayload, terminal: bool) {
        let mut guard = self.connections.lock().await;
        if guard
            .get(&self.tab_id)
            .is_none_or(|s| s.generation != self.generation)
        {
            return;
        }
        payload.connection_id = self.connection_id.clone();
        emit_event(&self.app, self.channel, payload);
        if terminal {
            guard.remove(&self.tab_id);
        }
    }
    async fn error(&self, message: String, terminal: bool) {
        self.emit(
            WsEventPayload::error(&self.tab_id, &self.url, message),
            terminal,
        )
        .await;
    }
}

trait SocketIo:
    Stream<Item = Result<Message, WsError>> + Sink<Message, Error = WsError> + Unpin + Send
{
}
impl<T> SocketIo for T where
    T: Stream<Item = Result<Message, WsError>> + Sink<Message, Error = WsError> + Unpin + Send
{
}
type Socket = Box<dyn SocketIo>;

fn target_authority(
    uri: &tokio_tungstenite::tungstenite::http::Uri,
    secure: bool,
) -> Result<(String, u16), String> {
    Ok((
        uri.host()
            .ok_or("The URL has no host to tunnel to")?
            .to_string(),
        uri.port_u16().unwrap_or(if secure { 443 } else { 80 }),
    ))
}
/// Reads the sub-protocol the server agreed to from the handshake response.
fn selected_subprotocol(
    response: &tokio_tungstenite::tungstenite::handshake::client::Response,
) -> Option<String> {
    response
        .headers()
        .get("Sec-WebSocket-Protocol")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

async fn establish_connection(
    channel: &'static WsChannel,
    url: String,
    headers: HashMap<String, String>,
    protocols: Vec<String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
    proxy: WsProxyAction,
) -> Result<(Socket, Option<String>), String> {
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
    // An explicit list from the request wins over the channel's static
    // sub-protocol and over any header row the user typed by hand.
    let offered = if protocols.is_empty() {
        channel.subprotocol.map(str::to_string)
    } else {
        Some(protocols.join(", "))
    };
    if let Some(offered) = offered {
        let header_value = offered
            .parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
            .map_err(|error| {
                format!(
                    "Invalid {}sub-protocol list '{}': {}",
                    channel.header_error_qualifier, offered, error
                )
            })?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", header_value);
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
            let (stream, response) = connect_async_tls_with_config(request, None, false, connector)
                .await
                .map_err(|error| format!("Failed to connect: {}", error))?;
            Ok((Box::new(stream) as Socket, selected_subprotocol(&response)))
        }
        WsProxyAction::Tunnel(endpoint) => {
            let (host, port) = target_authority(request.uri(), is_secure)?;
            let tunnel = connect_through_proxy(&endpoint, &host, port).await?;
            let (stream, response) = client_async_tls_with_config(request, tunnel, None, connector)
                .await
                .map_err(|error| format!("Failed to connect through proxy: {}", error))?;
            Ok((Box::new(stream) as Socket, selected_subprotocol(&response)))
        }
    }
}

/// Register before dialing. The acknowledgement means cancellation can now find the attempt.
async fn start<R: Runtime>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: &WsConnections,
    proxy: WsProxyAction,
    request: WsSendRequest,
    connection_id: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<oneshot::Receiver<Result<mpsc::UnboundedSender<WsCommand>, String>>, String> {
    require_tab_id(&request.tab_id)?;
    if request.url.trim().is_empty() {
        return Err(channel.url_required_error.into());
    }
    let (sender, receiver) = mpsc::unbounded_channel();
    let (shutdown, mut stopped) = watch::channel(false);
    let (ready, ready_rx) = oneshot::channel();
    let generation = connections.next_generation();
    let headers = request.headers.unwrap_or_default();
    let protocols = request.protocols.unwrap_or_default();
    let verify_ssl = request.verify_ssl != Some(false);
    let context = Lifecycle {
        app,
        channel,
        connections: connections.clone(),
        tab_id: request.tab_id.clone(),
        url: request.url.clone(),
        connection_id: connection_id.clone(),
        generation,
    };
    {
        let mut guard = connections.lock().await;
        if let Some(old) = guard.get_mut(&request.tab_id) {
            old.value.begin_close();
        }
        guard.insert(
            request.tab_id.clone(),
            Session {
                generation,
                value: WsConnection {
                    sender: sender.clone(),
                    shutdown,
                    connection_id,
                    url: request.url.clone(),
                    headers: headers.clone(),
                    protocols: protocols.clone(),
                    verify_ssl,
                    client_cert: request.client_cert.clone(),
                    open: false,
                    closing: false,
                },
            },
        );
    }
    tokio::spawn(async move {
        let dial = establish_connection(
            channel,
            request.url,
            headers,
            protocols,
            verify_ssl,
            request.client_cert,
            proxy,
        );
        let handshake = async {
            match timeout_ms.filter(|ms| *ms > 0) {
                Some(ms) => tokio::time::timeout(Duration::from_millis(ms), dial)
                    .await
                    .map_err(|_| format!("Connection timed out after {ms} ms"))?,
                None => dial.await,
            }
        };
        let (socket, protocol) = tokio::select! {
            biased;
            _ = async { let _ = stopped.wait_for(|value| *value).await; } => {
                context.emit(WsEventPayload::new(&context.tab_id, &context.url, "cancelled"), true).await;
                let _ = ready.send(Err("Connection cancelled".into()));
                return;
            }
            result = handshake => match result {
                Ok(connected) => connected,
                Err(error) => {
                    context.error(error.clone(), true).await;
                    let _ = ready.send(Err(error));
                    return;
                }
            }
        };
        {
            let mut guard = context.connections.lock().await;
            let Some(entry) = guard
                .get_mut(&context.tab_id)
                .filter(|s| s.generation == generation)
            else {
                return;
            };
            if entry.value.closing {
                drop(guard);
                context
                    .emit(
                        WsEventPayload::new(&context.tab_id, &context.url, "cancelled"),
                        true,
                    )
                    .await;
                let _ = ready.send(Err("Connection cancelled".into()));
                return;
            }
            entry.value.open = true;
            let mut payload = WsEventPayload::open(&context.tab_id, &context.url, protocol);
            payload.connection_id = context.connection_id.clone();
            emit_event(&context.app, channel, payload);
        }
        let _ = ready.send(Ok(sender.clone()));
        pump(context, socket, sender, receiver, stopped).await;
    });
    Ok(ready_rx)
}

async fn pump<R: Runtime>(
    context: Lifecycle<R>,
    socket: Socket,
    sender: mpsc::UnboundedSender<WsCommand>,
    mut receiver: mpsc::UnboundedReceiver<WsCommand>,
    mut stopped: watch::Receiver<bool>,
) {
    let (mut writer, mut reader) = socket.split();
    let mut write_task = tokio::spawn(async move {
        while let Some(command) = receiver.recv().await {
            match command {
                WsCommand::Send(text) => writer.send(Message::text(text)).await?,
                WsCommand::Close => {
                    writer
                        .send(Message::Close(Some(CloseFrame {
                            code: CloseCode::Normal,
                            reason: "".into(),
                        })))
                        .await?;
                    break;
                }
                WsCommand::Flush => {
                    writer.flush().await?;
                    break;
                }
            }
        }
        Ok::<(), WsError>(())
    });
    let deadline = tokio::time::sleep(CLOSE_TIMEOUT);
    tokio::pin!(deadline);
    let mut closing = false;
    let mut writer_done = false;
    let mut failure = None;
    let mut code = 1006;
    let mut reason = "Connection closed without a close frame".to_string();
    loop {
        tokio::select! {
            biased;
            _ = async { let _ = stopped.wait_for(|value| *value).await; }, if !closing => {
                closing = true;
                deadline.as_mut().reset(tokio::time::Instant::now() + CLOSE_TIMEOUT);
                let _ = sender.send(WsCommand::Close);
            }
            _ = &mut deadline, if closing => { failure = Some("Close handshake timed out".to_string()); reason = "Close handshake timed out".into(); break; }
            result = &mut write_task, if !writer_done => {
                writer_done = true;
                if let Err(error) = result.unwrap_or_else(|error| Err(WsError::Io(std::io::Error::other(error.to_string())))) {
                    failure = Some(error.to_string()); break;
                }
            }
            message = reader.next() => match message {
                Some(Ok(Message::Text(text))) => context.emit(WsEventPayload::message(&context.tab_id, &context.url, text.to_string()), false).await,
                Some(Ok(Message::Binary(bytes))) => context.emit(WsEventPayload::message(&context.tab_id, &context.url, format!("[Binary message received: {} bytes]", bytes.len())), false).await,
                Some(Ok(Message::Close(frame))) => {
                    code = frame.as_ref().map(|f| f.code.into()).unwrap_or(1005);
                    reason = frame.map(|f| f.reason.to_string()).unwrap_or_default();
                    // Reading queues the automatic close reply; flush it before dropping the socket.
                    if !writer_done {
                        let _ = sender.send(WsCommand::Flush);
                        let limit = if closing { deadline.deadline() } else { tokio::time::Instant::now() + CLOSE_TIMEOUT };
                        writer_done = tokio::time::timeout_at(limit, &mut write_task).await.is_ok();
                    }
                    break;
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => { failure = Some(error.to_string()); break; }
                None => { failure = Some(reason.clone()); break; }
            }
        }
    }
    if !writer_done {
        write_task.abort();
        let _ = write_task.await;
    }
    drop(reader);
    if let Some(error) = failure {
        context.error(error, false).await;
    }
    context
        .emit(
            WsEventPayload::close(&context.tab_id, &context.url, Some(code), Some(reason)),
            true,
        )
        .await;
}

pub(crate) async fn connect<R: Runtime>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: &WsConnections,
    proxy: &ProxySettings,
    request: WsConnectRequest,
) -> Result<CommandAck, String> {
    if request.connection_id.trim().is_empty() {
        return Err("Connection ID is required".into());
    }
    let action = proxy.ws_proxy_action(&request.options.url);
    let _ready = start(
        app,
        channel,
        connections,
        action,
        request.options,
        Some(request.connection_id),
        request.connect_timeout_ms,
    )
    .await?;
    Ok(CommandAck::ok())
}

pub(crate) async fn send_message(
    connections: &WsConnections,
    request: WsMessageRequest,
) -> Result<CommandAck, String> {
    require_tab_id(&request.tab_id)?;
    let guard = connections.lock().await;
    let entry = guard
        .get(&request.tab_id)
        .filter(|entry| {
            entry.value.connection_id.as_deref() == Some(request.connection_id.as_str())
                && entry.value.open
                && !entry.value.closing
        })
        .ok_or("WebSocket is not connected")?;
    entry
        .value
        .sender
        .send(WsCommand::Send(request.message))
        .map_err(|_| "WebSocket is not connected")?;
    Ok(CommandAck::ok())
}

/// GraphQL keeps its connect-or-reuse-and-send contract.
pub(crate) async fn send<R: Runtime>(
    app: AppHandle<R>,
    channel: &'static WsChannel,
    connections: &WsConnections,
    proxy: &ProxySettings,
    request: WsSendRequest,
) -> Result<CommandAck, String> {
    let existing = {
        let guard = connections.lock().await;
        guard
            .get(&request.tab_id)
            .filter(|entry| {
                entry.value.is_reusable_for(
                    &request.url,
                    &request.headers.clone().unwrap_or_default(),
                    request.protocols.as_deref().unwrap_or_default(),
                    request.verify_ssl != Some(false),
                    &request.client_cert,
                )
            })
            .map(|entry| entry.value.sender.clone())
    };
    let message = request.message.clone().unwrap_or_default();
    let sender = match existing {
        Some(sender) => sender,
        None => {
            let action = proxy.ws_proxy_action(&request.url);
            start(app, channel, connections, action, request, None, None)
                .await?
                .await
                .map_err(|_| "Connection cancelled".to_string())??
        }
    };
    if !message.is_empty() {
        sender
            .send(WsCommand::Send(message))
            .map_err(|_| channel.send_failed_error.to_string())?;
    }
    Ok(CommandAck::ok())
}

pub(crate) async fn close_matching(
    connections: &WsConnections,
    tab_id: String,
    connection_id: Option<&str>,
) -> Result<CommandAck, String> {
    require_tab_id(&tab_id)?;
    let mut guard = connections.lock().await;
    if let Some(entry) = guard.get_mut(&tab_id).filter(|entry| {
        connection_id.is_none() || entry.value.connection_id.as_deref() == connection_id
    }) {
        entry.value.begin_close();
    }
    Ok(CommandAck::ok())
}
pub(crate) async fn close(
    connections: &WsConnections,
    tab_id: String,
) -> Result<CommandAck, String> {
    close_matching(connections, tab_id, None).await
}

#[cfg(test)]
#[path = "ws_stream_lifecycle_tests.rs"]
mod lifecycle_tests;

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

    #[test]
    fn deserializes_a_send_request_with_protocols() {
        let request: WsSendRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "wss://example.com/socket",
            "protocols": ["chat", "superchat"]
        }))
        .expect("expected the request to deserialize");

        assert_eq!(
            request.protocols,
            Some(vec!["chat".to_string(), "superchat".to_string()])
        );
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
        assert!(request.protocols.is_none());
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
            protocols: None,
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
