use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};

use super::api_request::ClientCertConfig;
use super::tls::{build_ws_connector, ws_uri_is_secure};

const SUBPROTOCOL: &str = "graphql-transport-ws";

#[derive(Clone)]
struct SubscriptionConnection {
    sender: mpsc::UnboundedSender<SubscriptionCommand>,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
}

enum SubscriptionCommand {
    Send(String),
    Close,
}

pub struct GraphqlSubscriptionState {
    connections: Arc<Mutex<HashMap<String, SubscriptionConnection>>>,
}

impl Default for GraphqlSubscriptionState {
    fn default() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphqlSubscriptionSendRequest {
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
pub struct GraphqlSubscriptionCommandResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphqlSubscriptionEventPayload {
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

fn emit_event(app: &AppHandle, payload: GraphqlSubscriptionEventPayload) {
    let _ = app.emit("graphql-subscription-event", payload);
}

async fn remove_connection_if_current(
    state: &Arc<Mutex<HashMap<String, SubscriptionConnection>>>,
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
    state: Arc<Mutex<HashMap<String, SubscriptionConnection>>>,
    tab_id: String,
    url: String,
    headers: HashMap<String, String>,
    verify_ssl: bool,
    client_cert: Option<ClientCertConfig>,
) -> Result<mpsc::UnboundedSender<SubscriptionCommand>, String> {
    let mut request = url
        .clone()
        .into_client_request()
        .map_err(|error| format!("Failed to build subscription request: {}", error))?;
    for (key, value) in &headers {
        let header_name = key
            .parse::<tokio_tungstenite::tungstenite::http::header::HeaderName>()
            .map_err(|error| format!("Invalid header name '{}': {}", key, error))?;
        let header_value = value
            .parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
            .map_err(|error| format!("Invalid header value for '{}': {}", key, error))?;
        request.headers_mut().insert(header_name, header_value);
    }
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        tokio_tungstenite::tungstenite::http::HeaderValue::from_static(SUBPROTOCOL),
    );

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
    let (sender, mut receiver) = mpsc::unbounded_channel::<SubscriptionCommand>();

    {
        let mut connections = state.lock().await;
        connections.insert(
            tab_id.clone(),
            SubscriptionConnection {
                sender: sender.clone(),
                url: url.clone(),
                headers: headers.clone(),
                verify_ssl,
                client_cert: client_cert.clone(),
            },
        );
    }

    emit_event(
        &app,
        GraphqlSubscriptionEventPayload {
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
                SubscriptionCommand::Send(message) => {
                    if let Err(error) = writer.send(Message::Text(message)).await {
                        emit_event(
                            &write_app,
                            GraphqlSubscriptionEventPayload {
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
                SubscriptionCommand::Close => {
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
                        GraphqlSubscriptionEventPayload {
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
                        GraphqlSubscriptionEventPayload {
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
                    close_payload = Some(GraphqlSubscriptionEventPayload {
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
                        GraphqlSubscriptionEventPayload {
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
                GraphqlSubscriptionEventPayload {
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
    state: &GraphqlSubscriptionState,
    tab_id: &str,
    url: &str,
    headers: &HashMap<String, String>,
    verify_ssl: bool,
    client_cert: &Option<ClientCertConfig>,
) -> Result<mpsc::UnboundedSender<SubscriptionCommand>, String> {
    let existing = {
        let connections = state.connections.lock().await;
        connections.get(tab_id).cloned()
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

        let _ = connection.sender.send(SubscriptionCommand::Close);
        let mut connections = state.connections.lock().await;
        connections.remove(tab_id);
    }

    establish_connection(
        app,
        state.connections.clone(),
        tab_id.to_string(),
        url.to_string(),
        headers.clone(),
        verify_ssl,
        client_cert.clone(),
    )
    .await
}

#[tauri::command]
pub async fn graphql_subscription_send(
    app: AppHandle,
    state: State<'_, GraphqlSubscriptionState>,
    request: GraphqlSubscriptionSendRequest,
) -> Result<GraphqlSubscriptionCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    if request.url.trim().is_empty() {
        return Err("Subscription URL is required".to_string());
    }

    let message = request.message.unwrap_or_default();
    let headers = request.headers.unwrap_or_default();
    let verify_ssl = request.verify_ssl != Some(false);

    let sender = match get_or_create_connection(
        app.clone(),
        &state,
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
                GraphqlSubscriptionEventPayload {
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
            .send(SubscriptionCommand::Send(message))
            .map_err(|_| "Failed to send subscription message".to_string())?;
    }

    Ok(GraphqlSubscriptionCommandResponse { success: true })
}

#[tauri::command]
pub async fn graphql_subscription_close(
    state: State<'_, GraphqlSubscriptionState>,
    tab_id: String,
) -> Result<GraphqlSubscriptionCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    let connection = {
        let mut connections = state.connections.lock().await;
        connections.remove(&tab_id)
    };

    if let Some(connection) = connection {
        let _ = connection.sender.send(SubscriptionCommand::Close);
    }

    Ok(GraphqlSubscriptionCommandResponse { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_a_send_request_with_tls_options() {
        let request: GraphqlSubscriptionSendRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "wss://example.com/graphql",
            "headers": { "Authorization": "Bearer t" },
            "message": "{\"type\":\"connection_init\"}",
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
        let request: GraphqlSubscriptionSendRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "wss://example.com/graphql"
        }))
        .expect("expected the request to deserialize");

        assert_eq!(request.verify_ssl, None);
        assert!(request.client_cert.is_none());
        assert!(request.verify_ssl != Some(false));
    }

    #[test]
    fn only_a_secure_url_takes_the_connector_path() {
        let secure = "wss://example.com/graphql"
            .to_string()
            .into_client_request()
            .unwrap();
        let plain = "ws://example.com/graphql"
            .to_string()
            .into_client_request()
            .unwrap();

        assert!(ws_uri_is_secure(secure.uri()));
        assert!(!ws_uri_is_secure(plain.uri()));
    }
}
