use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CACHE_CONTROL};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

pub struct SseState {
    connections: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseConnectRequest {
    pub tab_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub last_event_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SseCommandResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SseEventPayload {
    tab_id: String,
    event_type: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    event: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn emit(app: &AppHandle, payload: SseEventPayload) {
    let _ = app.emit("sse-event", payload);
}

#[derive(Default)]
struct PartialEvent {
    event: Option<String>,
    data: Vec<String>,
    id: Option<String>,
    retry: Option<u64>,
}

impl PartialEvent {
    fn is_empty(&self) -> bool {
        self.event.is_none() && self.data.is_empty() && self.id.is_none() && self.retry.is_none()
    }

    fn dispatch(&mut self, app: &AppHandle, tab_id: &str, url: &str) {
        if self.data.is_empty() && self.event.is_none() && self.retry.is_none() {
            // Comment-only or empty frame; keep id but emit nothing.
            self.event = None;
            self.retry = None;
            return;
        }

        let data = if self.data.is_empty() {
            None
        } else {
            Some(self.data.join("\n"))
        };

        emit(
            app,
            SseEventPayload {
                tab_id: tab_id.to_string(),
                event_type: "message".to_string(),
                url: url.to_string(),
                event: self.event.take(),
                data,
                id: self.id.clone(),
                retry: self.retry.take(),
                status: None,
                message: None,
            },
        );

        self.data.clear();
    }
}

fn parse_line(line: &str, partial: &mut PartialEvent) {
    if line.is_empty() {
        return;
    }
    if line.starts_with(':') {
        return; // comment
    }

    let (field, value) = match line.find(':') {
        Some(idx) => {
            let (f, rest) = line.split_at(idx);
            let v = &rest[1..];
            let v = v.strip_prefix(' ').unwrap_or(v);
            (f, v)
        }
        None => (line, ""),
    };

    match field {
        "event" => partial.event = Some(value.to_string()),
        "data" => partial.data.push(value.to_string()),
        "id"
            // Spec: NULL byte in id is ignored; otherwise set last event id.
            if !value.contains('\0') => {
                partial.id = Some(value.to_string());
            }
        "retry" => {
            if let Ok(ms) = value.parse::<u64>() {
                partial.retry = Some(ms);
            }
        }
        _ => {}
    }
}

async fn run_stream(
    app: AppHandle,
    state: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    tab_id: String,
    url: String,
    headers: HashMap<String, String>,
    initial_last_event_id: Option<String>,
) {
    let client = match reqwest::Client::builder()
        .pool_idle_timeout(Duration::from_secs(0))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            emit(
                &app,
                SseEventPayload {
                    tab_id: tab_id.clone(),
                    event_type: "error".to_string(),
                    url: url.clone(),
                    event: None,
                    data: None,
                    id: None,
                    retry: None,
                    status: None,
                    message: Some(format!("Failed to build HTTP client: {}", e)),
                },
            );
            return;
        }
    };

    let mut last_event_id = initial_last_event_id;
    let mut retry_ms: u64 = 3000;
    let mut first_connect = true;

    loop {
        let mut header_map = HeaderMap::new();
        header_map.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
        header_map.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));

        for (k, v) in &headers {
            let name = match HeaderName::from_bytes(k.as_bytes()) {
                Ok(n) => n,
                Err(_) => {
                    emit(
                        &app,
                        SseEventPayload {
                            tab_id: tab_id.clone(),
                            event_type: "error".to_string(),
                            url: url.clone(),
                            event: None,
                            data: None,
                            id: None,
                            retry: None,
                            status: None,
                            message: Some(format!("Invalid header name: {}", k)),
                        },
                    );
                    break;
                }
            };
            if let Ok(val) = HeaderValue::from_str(v) {
                header_map.insert(name, val);
            }
        }

        if let Some(id) = &last_event_id {
            if let Ok(val) = HeaderValue::from_str(id) {
                header_map.insert(HeaderName::from_static("last-event-id"), val);
            }
        }

        let response = match client.get(&url).headers(header_map).send().await {
            Ok(r) => r,
            Err(e) => {
                emit(
                    &app,
                    SseEventPayload {
                        tab_id: tab_id.clone(),
                        event_type: "error".to_string(),
                        url: url.clone(),
                        event: None,
                        data: None,
                        id: None,
                        retry: None,
                        status: None,
                        message: Some(format!("Connection failed: {}", e)),
                    },
                );
                break;
            }
        };

        let status = response.status();
        if !status.is_success() {
            emit(
                &app,
                SseEventPayload {
                    tab_id: tab_id.clone(),
                    event_type: "error".to_string(),
                    url: url.clone(),
                    event: None,
                    data: None,
                    id: None,
                    retry: None,
                    status: Some(status.as_u16()),
                    message: Some(format!("HTTP {}", status.as_u16())),
                },
            );
            break;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !content_type.contains("text/event-stream") {
            emit(
                &app,
                SseEventPayload {
                    tab_id: tab_id.clone(),
                    event_type: "error".to_string(),
                    url: url.clone(),
                    event: None,
                    data: None,
                    id: None,
                    retry: None,
                    status: Some(status.as_u16()),
                    message: Some(format!(
                        "Unexpected Content-Type: {}",
                        if content_type.is_empty() {
                            "(none)"
                        } else {
                            &content_type
                        }
                    )),
                },
            );
            break;
        }

        emit(
            &app,
            SseEventPayload {
                tab_id: tab_id.clone(),
                event_type: if first_connect { "open" } else { "reopen" }.to_string(),
                url: url.clone(),
                event: None,
                data: None,
                id: None,
                retry: None,
                status: Some(status.as_u16()),
                message: None,
            },
        );
        first_connect = false;

        let mut response = response;
        let mut buffer = String::new();
        let mut partial = PartialEvent::default();

        loop {
            match response.chunk().await {
                Ok(Some(bytes)) => {
                    let text = match std::str::from_utf8(&bytes) {
                        Ok(s) => s.to_string(),
                        Err(_) => String::from_utf8_lossy(&bytes).into_owned(),
                    };
                    buffer.push_str(&text);

                    loop {
                        let newline_pos = buffer.find('\n');
                        let Some(pos) = newline_pos else { break };
                        let mut line: String = buffer.drain(..=pos).collect();
                        line.pop();
                        if line.ends_with('\r') {
                            line.pop();
                        }

                        if line.is_empty() {
                            partial.dispatch(&app, &tab_id, &url);
                            if let Some(id) = &partial.id {
                                last_event_id = Some(id.clone());
                            }
                            if let Some(r) = partial.retry {
                                retry_ms = r;
                            }
                        } else {
                            parse_line(&line, &mut partial);
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    emit(
                        &app,
                        SseEventPayload {
                            tab_id: tab_id.clone(),
                            event_type: "error".to_string(),
                            url: url.clone(),
                            event: None,
                            data: None,
                            id: None,
                            retry: None,
                            status: None,
                            message: Some(format!("Stream error: {}", e)),
                        },
                    );
                    break;
                }
            }
        }

        // Flush any trailing partial event if the stream ended on a non-empty buffer.
        if !partial.is_empty() {
            partial.dispatch(&app, &tab_id, &url);
            if let Some(id) = &partial.id {
                last_event_id = Some(id.clone());
            }
        }

        emit(
            &app,
            SseEventPayload {
                tab_id: tab_id.clone(),
                event_type: "reconnecting".to_string(),
                url: url.clone(),
                event: None,
                data: None,
                id: None,
                retry: Some(retry_ms),
                status: None,
                message: None,
            },
        );

        tokio::time::sleep(Duration::from_millis(retry_ms)).await;
    }

    emit(
        &app,
        SseEventPayload {
            tab_id: tab_id.clone(),
            event_type: "close".to_string(),
            url: url.clone(),
            event: None,
            data: None,
            id: None,
            retry: None,
            status: None,
            message: None,
        },
    );

    let mut connections = state.lock().await;
    if let Some(handle) = connections.get(&tab_id) {
        if handle.is_finished() {
            connections.remove(&tab_id);
        }
    }
}

#[tauri::command]
pub async fn sse_connect(
    app: AppHandle,
    state: State<'_, SseState>,
    request: SseConnectRequest,
) -> Result<SseCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }
    if request.url.trim().is_empty() {
        return Err("SSE URL is required".to_string());
    }

    // Close any existing connection on this tab.
    {
        let mut connections = state.connections.lock().await;
        if let Some(handle) = connections.remove(&request.tab_id) {
            handle.abort();
        }
    }

    let app_clone = app.clone();
    let connections = state.connections.clone();
    let tab_id = request.tab_id.clone();
    let url = request.url.clone();
    let headers = request.headers.unwrap_or_default();
    let last_event_id = request.last_event_id;

    let connections_for_task = connections.clone();
    let tab_id_for_task = tab_id.clone();
    let handle = tokio::spawn(async move {
        run_stream(
            app_clone,
            connections_for_task,
            tab_id_for_task,
            url,
            headers,
            last_event_id,
        )
        .await;
    });

    {
        let mut connections = state.connections.lock().await;
        connections.insert(tab_id, handle);
    }

    Ok(SseCommandResponse { success: true })
}

#[tauri::command]
pub async fn sse_close(
    state: State<'_, SseState>,
    tab_id: String,
) -> Result<SseCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    let handle = {
        let mut connections = state.connections.lock().await;
        connections.remove(&tab_id)
    };

    if let Some(handle) = handle {
        handle.abort();
    }

    Ok(SseCommandResponse { success: true })
}
