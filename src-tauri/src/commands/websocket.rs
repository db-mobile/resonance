//! Raw WebSocket transport. The socket lifecycle lives in
//! [`super::ws_stream`]; this module supplies the channel description and the
//! Tauri command surface.

use tauri::{AppHandle, State};

use super::ws_stream::{self, WsChannel, WsCommandResponse, WsConnections, WsSendRequest};

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
pub async fn websocket_send(
    app: AppHandle,
    state: State<'_, WebSocketState>,
    request: WsSendRequest,
) -> Result<WsCommandResponse, String> {
    ws_stream::send(app, &WEBSOCKET_CHANNEL, &state.connections, request).await
}

#[tauri::command]
pub async fn websocket_close(
    state: State<'_, WebSocketState>,
    tab_id: String,
) -> Result<WsCommandResponse, String> {
    ws_stream::close(&state.connections, tab_id).await
}
