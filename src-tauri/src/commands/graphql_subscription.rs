//! `graphql-transport-ws` subscription transport. Identical to the raw
//! WebSocket client apart from the advertised subprotocol and the event name,
//! so the socket lifecycle lives in [`super::ws_stream`]; this module supplies
//! the channel description and the Tauri command surface.

use tauri::{AppHandle, State};

use super::proxy::ProxyState;
use super::ws_stream::{self, WsChannel, WsCommandResponse, WsConnections, WsSendRequest};

pub(crate) static SUBSCRIPTION_CHANNEL: WsChannel = WsChannel {
    event_name: "graphql-subscription-event",
    subprotocol: Some("graphql-transport-ws"),
    request_label: "subscription",
    header_error_qualifier: "",
    url_required_error: "Subscription URL is required",
    send_failed_error: "Failed to send subscription message",
};

#[derive(Default)]
pub struct GraphqlSubscriptionState {
    connections: WsConnections,
}

#[tauri::command]
pub async fn graphql_subscription_send(
    app: AppHandle,
    state: State<'_, GraphqlSubscriptionState>,
    proxy_state: State<'_, ProxyState>,
    request: WsSendRequest,
) -> Result<WsCommandResponse, String> {
    ws_stream::send(
        app,
        &SUBSCRIPTION_CHANNEL,
        &state.connections,
        &proxy_state.snapshot(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn graphql_subscription_close(
    state: State<'_, GraphqlSubscriptionState>,
    tab_id: String,
) -> Result<WsCommandResponse, String> {
    ws_stream::close(&state.connections, tab_id).await
}
