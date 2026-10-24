//! Raw WebSocket transport. The socket lifecycle lives in
//! [`super::ws_stream`]; this module supplies the channel description and the
//! Tauri command surface.

use tauri::{AppHandle, State};

use super::proxy::ProxyState;
use super::tab_sessions::CommandAck;
use super::ws_stream::{self, WsChannel, WsConnectRequest, WsConnections, WsMessageRequest};

pub(crate) static WEBSOCKET_CHANNEL: WsChannel = WsChannel {
    event_name: "websocket-event",
    subprotocol: None,
    request_label: "WebSocket",
    header_error_qualifier: "WebSocket ",
    url_required_error: "WebSocket URL is required",
    send_failed_error: "Failed to send WebSocket message",
};

#[derive(Default)]
pub struct WebSocketState {
    connections: WsConnections,
}

#[tauri::command]
pub async fn websocket_connect(
    app: AppHandle,
    state: State<'_, WebSocketState>,
    proxy_state: State<'_, ProxyState>,
    request: WsConnectRequest,
) -> Result<CommandAck, String> {
    ws_stream::connect(
        app,
        &WEBSOCKET_CHANNEL,
        &state.connections,
        &proxy_state.snapshot(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn websocket_send(
    state: State<'_, WebSocketState>,
    request: WsMessageRequest,
) -> Result<CommandAck, String> {
    ws_stream::send_message(&state.connections, request).await
}

#[tauri::command]
pub async fn websocket_close(
    state: State<'_, WebSocketState>,
    tab_id: String,
    connection_id: String,
) -> Result<CommandAck, String> {
    ws_stream::close_matching(&state.connections, tab_id, Some(&connection_id)).await
}
