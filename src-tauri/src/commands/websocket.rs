use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};

#[derive(Clone)]
struct WebSocketConnection {
    sender: mpsc::UnboundedSender<WebSocketCommand>,
    url: String,
    headers: HashMap<String, String>,
}

enum WebSocketCommand {
    Send(String),
    Close,
}

pub struct WebSocketState {
    connections: Arc<Mutex<HashMap<String, WebSocketConnection>>>,
}

impl Default for WebSocketState {
    fn default() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketSendRequest {
    pub tab_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WebSocketCommandResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebSocketEventPayload {
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

fn emit_event(app: &AppHandle, payload: WebSocketEventPayload) {
    let _ = app.emit("websocket-event", payload);
}

async fn remove_connection_if_current(
    state: &Arc<Mutex<HashMap<String, WebSocketConnection>>>,
    tab_id: &str,
    url: &str,
) {
    let mut connections = state.lock().await;
    if matches!(connections.get(tab_id), Some(connection) if connection.url == url) {
        connections.remove(tab_id);
    }
}

async fn establish_connection(
    app: AppHandle,
    state: Arc<Mutex<HashMap<String, WebSocketConnection>>>,
    tab_id: String,
    url: String,
    headers: HashMap<String, String>,
) -> Result<mpsc::UnboundedSender<WebSocketCommand>, String> {
    let mut request = url
        .clone()
        .into_client_request()
        .map_err(|error| format!("Failed to build WebSocket request: {}", error))?;
    for (key, value) in &headers {
        let header_name = key
            .parse::<tokio_tungstenite::tungstenite::http::header::HeaderName>()
            .map_err(|error| format!("Invalid WebSocket header name '{}': {}", key, error))?;
        let header_value = value
            .parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
            .map_err(|error| format!("Invalid WebSocket header value for '{}': {}", key, error))?;
        request.headers_mut().insert(header_name, header_value);
    }

    let (stream, _) = connect_async(request)
        .await
        .map_err(|error| format!("Failed to connect: {}", error))?;

    let (mut writer, mut reader) = stream.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<WebSocketCommand>();

    {
        let mut connections = state.lock().await;
        connections.insert(
            tab_id.clone(),
            WebSocketConnection {
                sender: sender.clone(),
                url: url.clone(),
                headers: headers.clone(),
            },
        );
    }

    emit_event(
        &app,
        WebSocketEventPayload {
            tab_id: tab_id.clone(),
            event_type: "open".to_string(),
            url: url.clone(),
            message: None,
            code: Some(101),
            reason: Some("Switching Protocols".to_string()),
        },
    );

    let write_app = app.clone();
    let write_state = state.clone();
    let write_tab_id = tab_id.clone();
    let write_url = url.clone();
    tokio::spawn(async move {
        while let Some(command) = receiver.recv().await {
            match command {
                WebSocketCommand::Send(message) => {
                    if let Err(error) = writer.send(Message::Text(message)).await {
                        emit_event(
                            &write_app,
                            WebSocketEventPayload {
                                tab_id: write_tab_id.clone(),
                                event_type: "error".to_string(),
                                url: write_url.clone(),
                                message: Some(error.to_string()),
                                code: None,
                                reason: None,
                            },
                        );
                        break;
                    }
                }
                WebSocketCommand::Close => {
                    let _ = writer.send(Message::Close(None)).await;
                    break;
                }
            }
        }

        remove_connection_if_current(&write_state, &write_tab_id, &write_url).await;
    });

    let read_app = app.clone();
    let read_state = state.clone();
    tokio::spawn(async move {
        let mut close_payload = None;

        while let Some(message) = reader.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    emit_event(
                        &read_app,
                        WebSocketEventPayload {
                            tab_id: tab_id.clone(),
                            event_type: "message".to_string(),
                            url: url.clone(),
                            message: Some(text.to_string()),
                            code: None,
                            reason: None,
                        },
                    );
                }
                Ok(Message::Binary(bytes)) => {
                    emit_event(
                        &read_app,
                        WebSocketEventPayload {
                            tab_id: tab_id.clone(),
                            event_type: "message".to_string(),
                            url: url.clone(),
                            message: Some(format!(
                                "[Binary message received: {} bytes]",
                                bytes.len()
                            )),
                            code: None,
                            reason: None,
                        },
                    );
                }
                Ok(Message::Close(frame)) => {
                    close_payload = Some(WebSocketEventPayload {
                        tab_id: tab_id.clone(),
                        event_type: "close".to_string(),
                        url: url.clone(),
                        message: None,
                        code: frame.as_ref().map(|value| value.code.into()),
                        reason: frame.as_ref().map(|value| value.reason.to_string()),
                    });
                    break;
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {}
                Err(error) => {
                    emit_event(
                        &read_app,
                        WebSocketEventPayload {
                            tab_id: tab_id.clone(),
                            event_type: "error".to_string(),
                            url: url.clone(),
                            message: Some(error.to_string()),
                            code: None,
                            reason: None,
                        },
                    );
                    break;
                }
            }
        }

        if let Some(payload) = close_payload {
            emit_event(&read_app, payload);
        } else {
            emit_event(
                &read_app,
                WebSocketEventPayload {
                    tab_id: tab_id.clone(),
                    event_type: "close".to_string(),
                    url: url.clone(),
                    message: None,
                    code: Some(1000),
                    reason: Some("Connection closed".to_string()),
                },
            );
        }

        remove_connection_if_current(&read_state, &tab_id, &url).await;
    });

    Ok(sender)
}

async fn get_or_create_connection(
    app: AppHandle,
    state: &WebSocketState,
    tab_id: &str,
    url: &str,
    headers: &HashMap<String, String>,
) -> Result<mpsc::UnboundedSender<WebSocketCommand>, String> {
    let existing = {
        let connections = state.connections.lock().await;
        connections.get(tab_id).cloned()
    };

    if let Some(connection) = existing {
        if connection.url == url && connection.headers == *headers {
            return Ok(connection.sender);
        }

        let _ = connection.sender.send(WebSocketCommand::Close);
        let mut connections = state.connections.lock().await;
        connections.remove(tab_id);
    }

    establish_connection(
        app,
        state.connections.clone(),
        tab_id.to_string(),
        url.to_string(),
        headers.clone(),
    )
    .await
}

#[tauri::command]
pub async fn websocket_send(
    app: AppHandle,
    state: State<'_, WebSocketState>,
    request: WebSocketSendRequest,
) -> Result<WebSocketCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    if request.url.trim().is_empty() {
        return Err("WebSocket URL is required".to_string());
    }

    let message = request.message.unwrap_or_default();
    let headers = request.headers.unwrap_or_default();

    let sender = match get_or_create_connection(
        app.clone(),
        &state,
        &request.tab_id,
        &request.url,
        &headers,
    )
    .await
    {
        Ok(sender) => sender,
        Err(error) => {
            emit_event(
                &app,
                WebSocketEventPayload {
                    tab_id: request.tab_id.clone(),
                    event_type: "error".to_string(),
                    url: request.url.clone(),
                    message: Some(error.clone()),
                    code: None,
                    reason: None,
                },
            );
            return Err(error);
        }
    };

    if !message.is_empty() {
        sender
            .send(WebSocketCommand::Send(message))
            .map_err(|_| "Failed to send WebSocket message".to_string())?;
    }

    Ok(WebSocketCommandResponse { success: true })
}

#[tauri::command]
pub async fn websocket_close(
    state: State<'_, WebSocketState>,
    tab_id: String,
) -> Result<WebSocketCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    let connection = {
        let mut connections = state.connections.lock().await;
        connections.remove(&tab_id)
    };

    if let Some(connection) = connection {
        let _ = connection.sender.send(WebSocketCommand::Close);
    }

    Ok(WebSocketCommandResponse { success: true })
}
