use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CACHE_CONTROL};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};

use super::api_request::ClientCertConfig;
use super::http_client::{build_http_client, HttpClientOptions};
use super::proxy::{ProxyAction, ProxyState};

/// Reconnection delay used until the server sends its own `retry:` field.
const DEFAULT_RETRY_MS: u64 = 3000;

type Connections = Arc<Mutex<HashMap<String, SseConnection>>>;

/// A live stream, keyed by tab. `id` distinguishes generations so a task that
/// has already been replaced cannot clean up (or emit `close` for) its
/// successor. Shutdown is cooperative: the task selects on the receiver, so it
/// unwinds normally and still emits its terminal event.
struct SseConnection {
    id: u64,
    shutdown: Option<oneshot::Sender<()>>,
}

pub struct SseState {
    connections: Connections,
    next_id: AtomicU64,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
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
    /// Mirrors the HTTP request options: `Some(false)` turns certificate
    /// verification off, and the client certificate / custom CA are resolved
    /// per host by the frontend from the certificate store.
    #[serde(default)]
    pub verify_ssl: Option<bool>,
    #[serde(default)]
    pub client_cert: Option<ClientCertConfig>,
    /// Defaults to GET. A streaming endpoint that takes a request document —
    /// an LLM completion, say — is normally a POST.
    #[serde(default)]
    pub method: Option<String>,
    /// Raw request body, replayed verbatim on every reconnect. The frontend
    /// serializes it and sets the matching Content-Type header.
    #[serde(default)]
    pub body: Option<String>,
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

fn payload(tab_id: &str, url: &str, event_type: &str) -> SseEventPayload {
    SseEventPayload {
        tab_id: tab_id.to_string(),
        event_type: event_type.to_string(),
        url: url.to_string(),
        event: None,
        data: None,
        id: None,
        retry: None,
        status: None,
        message: None,
    }
}

fn emit(app: &AppHandle, payload: SseEventPayload) {
    let _ = app.emit("sse-event", payload);
}

fn emit_error(app: &AppHandle, tab_id: &str, url: &str, status: Option<u16>, message: String) {
    let mut event = payload(tab_id, url, "error");
    event.status = status;
    event.message = Some(message);
    emit(app, event);
}

/// Remove this tab's entry only when it still belongs to generation `id`.
/// Returns whether the caller was still the current connection.
async fn remove_connection_if_current(connections: &Connections, tab_id: &str, id: u64) -> bool {
    let mut connections = connections.lock().await;
    if matches!(connections.get(tab_id), Some(connection) if connection.id == id) {
        connections.remove(tab_id);
        return true;
    }
    false
}

#[derive(Debug, Default, PartialEq)]
struct EventParts {
    event: Option<String>,
    data: Option<String>,
    id: Option<String>,
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

    /// Consume the buffered fields at a frame boundary. Returns `None` for
    /// comment-only or empty frames. `id` is deliberately retained: per spec the
    /// last event id persists across subsequent frames.
    fn take_payload(&mut self) -> Option<EventParts> {
        if self.data.is_empty() && self.event.is_none() {
            return None;
        }

        let data = if self.data.is_empty() {
            None
        } else {
            Some(self.data.join("\n"))
        };
        self.data.clear();

        Some(EventParts {
            event: self.event.take(),
            data,
            id: self.id.clone(),
        })
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

/// Drain complete lines (LF- or CRLF-terminated) from `buffer`, leaving any
/// trailing incomplete line behind. Only whole lines are decoded, so a
/// multi-byte character split across two network chunks is reassembled before
/// it is turned into text rather than being mangled into U+FFFD.
fn drain_lines(buffer: &mut Vec<u8>) -> Vec<String> {
    let mut lines = Vec::new();

    while let Some(pos) = buffer.iter().position(|byte| *byte == b'\n') {
        let mut line: Vec<u8> = buffer.drain(..=pos).collect();
        line.pop();
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        lines.push(String::from_utf8_lossy(&line).into_owned());
    }

    lines
}

/// Build the request headers for one connection attempt. An unusable
/// caller-supplied header is fatal — sending the request without it would
/// silently drop credentials. A `last_event_id` that cannot be encoded is
/// skipped instead, since it originates from the server and must not make the
/// stream permanently unresumable.
fn build_header_map(
    headers: &HashMap<String, String>,
    last_event_id: Option<&str>,
) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    header_map.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    header_map.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));

    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("Invalid header name: {}", name))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|_| format!("Invalid header value for: {}", name))?;
        header_map.insert(header_name, header_value);
    }

    if let Some(id) = last_event_id {
        if let Ok(value) = HeaderValue::from_str(id) {
            header_map.insert(HeaderName::from_static("last-event-id"), value);
        }
    }

    Ok(header_map)
}

fn dispatch(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
    partial: &mut PartialEvent,
    last_event_id: &mut Option<String>,
) {
    if let Some(parts) = partial.take_payload() {
        let mut event = payload(tab_id, url, "message");
        event.event = parts.event;
        event.data = parts.data;
        event.id = parts.id;
        emit(app, event);
    }

    if let Some(id) = &partial.id {
        *last_event_id = Some(id.clone());
    }
}

/// Everything one stream needs about what it is connecting to, kept together so
/// it can be threaded through the task without a long parameter list.
struct StreamTarget {
    tab_id: String,
    url: String,
    method: Method,
    body: Option<String>,
    headers: HashMap<String, String>,
    last_event_id: Option<String>,
}

/// Connect, stream, and reconnect until the stream fails fatally or the caller
/// signals shutdown. Every exit path returns to `run_stream`, which owns the
/// single terminal `close` emit.
async fn stream_loop(
    app: &AppHandle,
    client: &reqwest::Client,
    target: &StreamTarget,
    shutdown: &mut oneshot::Receiver<()>,
) {
    let StreamTarget {
        tab_id,
        url,
        method,
        body,
        headers,
        last_event_id: initial_last_event_id,
    } = target;
    let (tab_id, url) = (tab_id.as_str(), url.as_str());

    let mut last_event_id = initial_last_event_id.clone();
    let mut retry_ms: u64 = DEFAULT_RETRY_MS;
    let mut first_connect = true;

    loop {
        let header_map = match build_header_map(headers, last_event_id.as_deref()) {
            Ok(map) => map,
            Err(message) => {
                emit_error(app, tab_id, url, None, message);
                return;
            }
        };

        // The body is re-sent on every attempt: a reconnect has to repeat the
        // original request, not replay a consumed stream.
        let mut attempt = client.request(method.clone(), url).headers(header_map);
        if let Some(body) = body {
            attempt = attempt.body(body.clone());
        }

        let mut response = tokio::select! {
            _ = &mut *shutdown => return,
            result = attempt.send() => match result {
                Ok(response) => response,
                Err(e) => {
                    emit_error(app, tab_id, url, None, format!("Connection failed: {}", e));
                    return;
                }
            }
        };

        let status = response.status();
        if !status.is_success() {
            emit_error(
                app,
                tab_id,
                url,
                Some(status.as_u16()),
                format!("HTTP {}", status.as_u16()),
            );
            return;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !content_type.contains("text/event-stream") {
            emit_error(
                app,
                tab_id,
                url,
                Some(status.as_u16()),
                format!(
                    "Unexpected Content-Type: {}",
                    if content_type.is_empty() {
                        "(none)"
                    } else {
                        &content_type
                    }
                ),
            );
            return;
        }

        let mut open = payload(tab_id, url, if first_connect { "open" } else { "reopen" });
        open.status = Some(status.as_u16());
        emit(app, open);
        first_connect = false;

        let mut buffer: Vec<u8> = Vec::new();
        let mut partial = PartialEvent::default();
        let mut cancelled = false;

        loop {
            let chunk = tokio::select! {
                _ = &mut *shutdown => {
                    cancelled = true;
                    break;
                }
                result = response.chunk() => result,
            };

            match chunk {
                Ok(Some(bytes)) => {
                    buffer.extend_from_slice(&bytes);
                    for line in drain_lines(&mut buffer) {
                        if line.is_empty() {
                            dispatch(app, tab_id, url, &mut partial, &mut last_event_id);
                        } else {
                            parse_line(&line, &mut partial);
                            if let Some(ms) = partial.retry.take() {
                                retry_ms = ms;
                            }
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    emit_error(app, tab_id, url, None, format!("Stream error: {}", e));
                    break;
                }
            }
        }

        if cancelled {
            return;
        }

        // Flush any trailing partial event if the stream ended on a non-empty buffer.
        if !partial.is_empty() {
            dispatch(app, tab_id, url, &mut partial, &mut last_event_id);
        }

        let mut reconnecting = payload(tab_id, url, "reconnecting");
        reconnecting.retry = Some(retry_ms);
        emit(app, reconnecting);

        tokio::select! {
            _ = &mut *shutdown => return,
            _ = tokio::time::sleep(Duration::from_millis(retry_ms)) => {}
        }
    }
}

async fn run_stream(
    app: AppHandle,
    connections: Connections,
    id: u64,
    client: reqwest::Client,
    target: StreamTarget,
    mut shutdown: oneshot::Receiver<()>,
) {
    stream_loop(&app, &client, &target, &mut shutdown).await;

    // Only the generation that still owns the tab reports the close, so a
    // stream that was superseded by a newer connect stays silent.
    if remove_connection_if_current(&connections, &target.tab_id, id).await {
        emit(&app, payload(&target.tab_id, &target.url, "close"));
    }
}

/// Build the client for one stream. Unlike a normal request this one must have
/// **no** timeout — a stream is expected to stay open indefinitely — and must
/// not force an HTTP version, since `http2_prior_knowledge` would break SSE
/// against HTTP/1 servers. TLS verification, client certificates and the proxy
/// come from the same settings the HTTP path uses.
fn build_sse_client(
    request: &SseConnectRequest,
    proxy_action: ProxyAction,
) -> Result<reqwest::Client, String> {
    build_http_client(
        HttpClientOptions {
            user_agent: format!("resonance/{}", env!("CARGO_PKG_VERSION")),
            timeout: None,
            http_version: None,
            verify_ssl: request.verify_ssl != Some(false),
            client_cert: request.client_cert.clone(),
            follow_redirects: true,
            disable_pooling: true,
        },
        proxy_action,
    )
}

#[tauri::command]
pub async fn sse_connect(
    app: AppHandle,
    state: State<'_, SseState>,
    proxy_state: State<'_, ProxyState>,
    mut request: SseConnectRequest,
) -> Result<SseCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }
    if request.url.trim().is_empty() {
        return Err("SSE URL is required".to_string());
    }

    let method = match request.method.as_deref() {
        Some(method) => method
            .parse::<Method>()
            .map_err(|e| format!("Invalid HTTP method: {}", e))?,
        None => Method::GET,
    };

    // Build the client before touching the connection map: an unusable
    // certificate must fail this call outright rather than tear down whatever
    // stream the tab already has running.
    let proxy_action = proxy_state.get_proxy_config(&request.url);
    let client = build_sse_client(&request, proxy_action)?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);

    // Hold the lock across signal + spawn + insert so a concurrent connect on
    // the same tab cannot interleave and leave the older stream registered.
    let mut connections = state.connections.lock().await;

    if let Some(previous) = connections.get_mut(&request.tab_id) {
        if let Some(shutdown) = previous.shutdown.take() {
            let _ = shutdown.send(());
        }
    }

    tokio::spawn(run_stream(
        app.clone(),
        state.connections.clone(),
        id,
        client,
        StreamTarget {
            tab_id: request.tab_id.clone(),
            url: request.url.clone(),
            method,
            body: request.body.take(),
            headers: request.headers.take().unwrap_or_default(),
            last_event_id: request.last_event_id.take(),
        },
        shutdown_rx,
    ));

    connections.insert(
        request.tab_id,
        SseConnection {
            id,
            shutdown: Some(shutdown_tx),
        },
    );

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

    // The entry stays in place: the task removes itself once it has unwound,
    // which is what lets it emit the terminal `close` for this tab.
    let mut connections = state.connections.lock().await;
    if let Some(connection) = connections.get_mut(&tab_id) {
        if let Some(shutdown) = connection.shutdown.take() {
            let _ = shutdown.send(());
        }
    }

    Ok(SseCommandResponse { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_frame(lines: &[&str]) -> PartialEvent {
        let mut partial = PartialEvent::default();
        for line in lines {
            parse_line(line, &mut partial);
        }
        partial
    }

    #[test]
    fn strips_exactly_one_space_after_the_colon() {
        let partial = parse_frame(&["data: hello", "data:  indented", "data:tight"]);
        assert_eq!(partial.data, vec!["hello", " indented", "tight"]);
    }

    #[test]
    fn treats_a_line_without_a_colon_as_a_field_with_an_empty_value() {
        let partial = parse_frame(&["data"]);
        assert_eq!(partial.data, vec![""]);
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let partial = parse_frame(&[": keep-alive", "banana: yellow", ":"]);
        assert!(partial.is_empty());
    }

    #[test]
    fn joins_multiple_data_lines_with_a_newline() {
        let mut partial = parse_frame(&["event: update", "data: one", "data: two"]);
        let parts = partial.take_payload().expect("expected a payload");
        assert_eq!(parts.event, Some("update".to_string()));
        assert_eq!(parts.data, Some("one\ntwo".to_string()));
    }

    #[test]
    fn an_empty_data_field_still_dispatches() {
        let mut partial = parse_frame(&["data:"]);
        let parts = partial.take_payload().expect("expected a payload");
        assert_eq!(parts.data, Some(String::new()));
    }

    #[test]
    fn ignores_an_id_containing_a_null_byte() {
        let partial = parse_frame(&["id: a\0b"]);
        assert_eq!(partial.id, None);
    }

    #[test]
    fn the_last_event_id_persists_into_the_following_frame() {
        let mut partial = parse_frame(&["id: 42", "data: first"]);
        let first = partial.take_payload().expect("expected a payload");
        assert_eq!(first.id, Some("42".to_string()));

        parse_line("data: second", &mut partial);
        let second = partial.take_payload().expect("expected a payload");
        assert_eq!(second.id, Some("42".to_string()));
        assert_eq!(second.data, Some("second".to_string()));
    }

    #[test]
    fn parses_retry_and_ignores_a_non_numeric_one() {
        assert_eq!(parse_frame(&["retry: 5000"]).retry, Some(5000));
        assert_eq!(parse_frame(&["retry: soon"]).retry, None);
    }

    #[test]
    fn take_payload_returns_none_for_empty_and_comment_only_frames() {
        assert_eq!(PartialEvent::default().take_payload(), None);
        assert_eq!(parse_frame(&[": ping"]).take_payload(), None);
        assert_eq!(parse_frame(&["id: 7"]).take_payload(), None);
    }

    #[test]
    fn take_payload_clears_data_and_event_but_not_id() {
        let mut partial = parse_frame(&["id: 7", "event: tick", "data: x"]);
        partial.take_payload().expect("expected a payload");
        assert!(partial.data.is_empty());
        assert_eq!(partial.event, None);
        assert_eq!(partial.id, Some("7".to_string()));
    }

    #[test]
    fn drains_lf_and_crlf_terminated_lines() {
        let mut buffer = b"data: one\ndata: two\r\n\r\n".to_vec();
        assert_eq!(
            drain_lines(&mut buffer),
            vec![
                "data: one".to_string(),
                "data: two".to_string(),
                String::new()
            ]
        );
        assert!(buffer.is_empty());
    }

    #[test]
    fn leaves_an_unterminated_line_buffered() {
        let mut buffer = b"data: done\ndata: partial".to_vec();
        assert_eq!(drain_lines(&mut buffer), vec!["data: done".to_string()]);
        assert_eq!(buffer, b"data: partial");
        assert!(drain_lines(&mut buffer).is_empty());
    }

    #[test]
    fn reassembles_a_multi_byte_character_split_across_chunks() {
        let frame = "data: 🎉\n".as_bytes();
        let (head, tail) = frame.split_at(8);
        assert!(
            std::str::from_utf8(head).is_err(),
            "split must land mid-character"
        );

        let mut buffer = head.to_vec();
        assert!(drain_lines(&mut buffer).is_empty());

        buffer.extend_from_slice(tail);
        assert_eq!(drain_lines(&mut buffer), vec!["data: 🎉".to_string()]);
    }

    #[test]
    fn builds_headers_with_accept_and_last_event_id() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer token".to_string());

        let map = build_header_map(&headers, Some("42")).expect("expected a header map");
        assert_eq!(map.get(ACCEPT).unwrap(), "text/event-stream");
        assert_eq!(map.get("authorization").unwrap(), "Bearer token");
        assert_eq!(map.get("last-event-id").unwrap(), "42");
    }

    #[test]
    fn rejects_an_invalid_header_name_or_value() {
        let mut bad_name = HashMap::new();
        bad_name.insert("Bad Header".to_string(), "value".to_string());
        let err = build_header_map(&bad_name, None).expect_err("expected an error");
        assert!(err.contains("Invalid header name"));

        let mut bad_value = HashMap::new();
        bad_value.insert("X-Trace".to_string(), "line\nbreak".to_string());
        let err = build_header_map(&bad_value, None).expect_err("expected an error");
        assert!(err.contains("Invalid header value"));
    }

    #[test]
    fn deserializes_a_connect_request_with_tls_options() {
        let request: SseConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "https://example.com/events",
            "headers": { "Authorization": "Bearer t" },
            "lastEventId": "42",
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
    fn deserializes_a_connect_request_with_a_method_and_body() {
        let request: SseConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "https://api.example.com/v1/stream",
            "method": "POST",
            "body": "{\"prompt\":\"hi\",\"stream\":true}"
        }))
        .expect("expected the request to deserialize");

        assert_eq!(request.method.as_deref(), Some("POST"));
        assert_eq!(
            request.body.as_deref(),
            Some("{\"prompt\":\"hi\",\"stream\":true}")
        );
        assert_eq!(
            request
                .method
                .as_deref()
                .unwrap()
                .parse::<Method>()
                .unwrap(),
            Method::POST
        );
    }

    #[test]
    fn an_absent_method_means_get_and_an_invalid_one_is_rejected() {
        let request: SseConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "https://example.com/events"
        }))
        .unwrap();
        assert!(request.method.is_none());
        assert!(request.body.is_none());

        assert!("GET FETCH".parse::<Method>().is_err());
    }

    #[test]
    fn deserializes_a_connect_request_without_tls_options() {
        let request: SseConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "https://example.com/events"
        }))
        .expect("expected the request to deserialize");

        assert_eq!(request.verify_ssl, None);
        assert!(request.client_cert.is_none());
        assert!(request.headers.is_none());
    }

    #[test]
    fn an_sse_client_verifies_by_default_and_builds_without_a_timeout() {
        let request: SseConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "https://example.com/events"
        }))
        .unwrap();
        assert!(build_sse_client(&request, ProxyAction::Disable).is_ok());
    }

    #[test]
    fn an_sse_client_surfaces_a_bad_certificate_instead_of_connecting() {
        let request: SseConnectRequest = serde_json::from_value(serde_json::json!({
            "tabId": "tab-1",
            "url": "https://example.com/events",
            "clientCert": { "certPath": "/certs/client.crt" }
        }))
        .unwrap();
        let err = build_sse_client(&request, ProxyAction::Disable).unwrap_err();
        assert!(err.contains("both a certificate and a key"));
    }

    #[test]
    fn skips_an_unusable_last_event_id_rather_than_failing() {
        let map =
            build_header_map(&HashMap::new(), Some("bad\nid")).expect("expected a header map");
        assert!(map.get("last-event-id").is_none());
    }
}
