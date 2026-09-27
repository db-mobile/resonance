use axum::{
    Router,
    extract::{Query, State as AxumState},
    http::{Method, StatusCode, Uri},
    response::Json,
    routing::any,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockServerSettings {
    pub port: u16,
    #[serde(default)]
    pub endpoint_delays: HashMap<String, u64>,
    #[serde(default)]
    pub custom_responses: HashMap<String, Value>,
    #[serde(default)]
    pub custom_status_codes: HashMap<String, u16>,
}

#[derive(Debug, Clone)]
pub struct MockEndpoint {
    pub method: String,
    pub path_regex: Regex,
    #[allow(dead_code)] // Stored for debugging/future use
    pub path_pattern: String,
    #[allow(dead_code)] // Stored for path parameter extraction
    pub param_names: Vec<String>,
    pub endpoint: Value,
    pub collection_id: String,
    pub collection_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: String,
    pub timestamp: i64,
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub response_status: u16,
    pub response_time: u64,
    pub matched_endpoint: Option<MatchedEndpointInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedEndpointInfo {
    pub collection_id: String,
    pub collection_name: String,
    pub endpoint_id: String,
    pub endpoint_name: String,
}

#[derive(Clone)]
pub struct MockServerState {
    pub endpoints: Arc<RwLock<Vec<MockEndpoint>>>,
    pub settings: Arc<RwLock<MockServerSettings>>,
    pub logs: Arc<RwLock<Vec<RequestLog>>>,
}

struct ServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    port: u16,
    state: MockServerState,
}

static SERVER_HANDLE: std::sync::OnceLock<RwLock<Option<ServerHandle>>> =
    std::sync::OnceLock::new();

fn get_server_handle() -> &'static RwLock<Option<ServerHandle>> {
    SERVER_HANDLE.get_or_init(|| RwLock::new(None))
}

#[tauri::command]
pub async fn mock_server_start(
    settings: MockServerSettings,
    collections: Vec<Value>,
) -> Result<Value, String> {
    // Check if already running
    {
        let handle = get_server_handle().read().unwrap();
        if handle.is_some() {
            return Ok(serde_json::json!({
                "success": false,
                "message": "Server is already running"
            }));
        }
    }

    let endpoints = build_routing_table(&collections);

    if endpoints.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "message": "No endpoints to mock. Please enable at least one collection."
        }));
    }

    let state = MockServerState {
        endpoints: Arc::new(RwLock::new(endpoints)),
        settings: Arc::new(RwLock::new(settings.clone())),
        logs: Arc::new(RwLock::new(Vec::new())),
    };

    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    let app = build_router(state.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], settings.port));

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            let message = if e.kind() == std::io::ErrorKind::AddrInUse {
                format!("Port {} is already in use", settings.port)
            } else {
                e.to_string()
            };
            return Ok(serde_json::json!({
                "success": false,
                "message": message
            }));
        }
    };

    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    *get_server_handle().write().unwrap() = Some(ServerHandle {
        shutdown_tx: Some(shutdown_tx),
        port: settings.port,
        state,
    });

    Ok(serde_json::json!({
        "success": true,
        "message": format!("Server started on port {}", settings.port),
        "port": settings.port
    }))
}

#[tauri::command]
pub async fn mock_server_stop() -> Result<Value, String> {
    let mut handle = get_server_handle().write().unwrap();

    if let Some(mut server) = handle.take() {
        if let Some(tx) = server.shutdown_tx.take() {
            let _ = tx.send(());
        }
        Ok(serde_json::json!({
            "success": true,
            "message": "Server stopped successfully"
        }))
    } else {
        Ok(serde_json::json!({
            "success": false,
            "message": "Server is not running"
        }))
    }
}

#[tauri::command]
pub async fn mock_server_status() -> Result<Value, String> {
    let handle = get_server_handle().read().unwrap();

    if let Some(server) = handle.as_ref() {
        let log_count = server.state.logs.read().unwrap().len();
        Ok(serde_json::json!({
            "running": true,
            "port": server.port,
            "requestCount": log_count
        }))
    } else {
        Ok(serde_json::json!({
            "running": false,
            "port": null,
            "requestCount": 0
        }))
    }
}

#[tauri::command]
pub async fn mock_server_logs(limit: Option<usize>) -> Result<Vec<RequestLog>, String> {
    let handle = get_server_handle().read().unwrap();

    if let Some(server) = handle.as_ref() {
        let logs = server.state.logs.read().unwrap();
        let limit = limit.unwrap_or(20);
        let result: Vec<RequestLog> = logs.iter().rev().take(limit).cloned().collect();
        Ok(result)
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn mock_server_clear_logs() -> Result<Value, String> {
    let handle = get_server_handle().read().unwrap();

    if let Some(server) = handle.as_ref() {
        server.state.logs.write().unwrap().clear();
        Ok(serde_json::json!({ "success": true }))
    } else {
        Ok(serde_json::json!({ "success": false, "message": "Server is not running" }))
    }
}

#[tauri::command]
pub async fn mock_server_reload_settings() -> Result<Value, String> {
    // Settings are stored in the state, would need to reload from store
    // For now, just return success
    Ok(serde_json::json!({
        "success": true,
        "message": "Settings reloaded successfully"
    }))
}

const MAX_LOGS: usize = 100;

/// Reduce a stored endpoint path to the request path the mock server sees:
/// absolute URLs (cURL imports) and a leading `{{baseUrl}}`-style host token
/// are stripped, as are query strings and fragments.
fn normalize_mock_path(raw: &str) -> String {
    let mut path = raw.trim();

    if let Some(idx) = path.find("://")
        && path[..idx].chars().all(|c| c.is_ascii_alphabetic())
    {
        let after = &path[idx + 3..];
        path = after.find('/').map_or("", |slash| &after[slash..]);
    } else if path.starts_with("{{")
        && let Some(close) = path.find("}}")
    {
        let rest = &path[close + 2..];
        if rest.is_empty() || rest.starts_with('/') || rest.starts_with('?') {
            path = rest;
        }
    }

    let path = path.split(['?', '#']).next().unwrap_or("");
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}

struct CompiledPath {
    pattern: String,
    param_names: Vec<String>,
    literal_segments: usize,
}

/// Compile a path template into an anchored regex. Literal text is escaped;
/// `{name}`, `{{name}}` and whole-segment `:name` become single-segment
/// captures.
fn compile_mock_path(path: &str) -> CompiledPath {
    let mut param_names = Vec::new();
    let mut literal_segments = 0;
    let mut segments = Vec::new();

    for segment in path.split('/') {
        if let Some(name) = segment.strip_prefix(':')
            && !name.is_empty()
        {
            param_names.push(name.to_string());
            segments.push("([^/]+)".to_string());
            continue;
        }

        let mut out = String::new();
        let mut rest = segment;
        let mut has_param = false;
        while let Some(open) = rest.find('{') {
            out.push_str(&regex::escape(&rest[..open]));
            let (inner_start, closer) = if rest[open..].starts_with("{{") {
                (open + 2, "}}")
            } else {
                (open + 1, "}")
            };
            match rest[inner_start..].find(closer) {
                Some(len) => {
                    param_names.push(rest[inner_start..inner_start + len].trim().to_string());
                    out.push_str("([^/]+)");
                    has_param = true;
                    rest = &rest[inner_start + len + closer.len()..];
                }
                None => {
                    out.push_str(&regex::escape(&rest[open..]));
                    rest = "";
                }
            }
        }
        out.push_str(&regex::escape(rest));
        if !has_param && !segment.is_empty() {
            literal_segments += 1;
        }
        segments.push(out);
    }

    CompiledPath {
        pattern: format!("^{}$", segments.join("/")),
        param_names,
        literal_segments,
    }
}

fn build_routing_table(collections: &[Value]) -> Vec<MockEndpoint> {
    let mut ranked = Vec::new();

    for collection in collections {
        let collection_id = collection
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let collection_name = collection
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if let Some(eps) = collection.get("endpoints").and_then(|e| e.as_array()) {
            for ep in eps {
                let method = ep
                    .get("method")
                    .and_then(|m| m.as_str())
                    .unwrap_or("GET")
                    .to_uppercase();

                let raw_path = ep.get("path").and_then(|p| p.as_str()).unwrap_or("/");
                let path = normalize_mock_path(raw_path);
                let compiled = compile_mock_path(&path);

                let Ok(path_regex) = Regex::new(&compiled.pattern) else {
                    continue;
                };

                let rank = (
                    std::cmp::Reverse(compiled.literal_segments),
                    compiled.param_names.len(),
                );
                ranked.push((
                    rank,
                    MockEndpoint {
                        method,
                        path_regex,
                        path_pattern: path,
                        param_names: compiled.param_names,
                        endpoint: ep.clone(),
                        collection_id: collection_id.clone(),
                        collection_name: collection_name.clone(),
                    },
                ));
            }
        }
    }

    ranked.sort_by_key(|a| a.0);
    ranked.into_iter().map(|(_, endpoint)| endpoint).collect()
}

fn push_log(state: &MockServerState, log: RequestLog) {
    let mut logs = state.logs.write().unwrap();
    logs.push(log);
    if logs.len() > MAX_LOGS {
        let excess = logs.len() - MAX_LOGS;
        logs.drain(..excess);
    }
}

/// Build the mock-server router.
///
/// No CORS layer is attached: the app reaches the mock server through the Rust
/// HTTP client, not the webview, so no browser origin needs cross-origin access.
/// Without CORS headers the browser same-origin policy stays in force, so a web
/// page the user happens to visit cannot read the loopback mock responses (which
/// mirror collection/endpoint names and example payloads). A permissive layer
/// here would also make the server reachable via DNS rebinding.
fn build_router(state: MockServerState) -> Router {
    Router::new()
        .route("/*path", any(handle_mock_request))
        .route("/", any(handle_mock_request))
        .with_state(state)
}

async fn handle_mock_request(
    method: Method,
    uri: Uri,
    Query(query): Query<HashMap<String, String>>,
    AxumState(state): AxumState<MockServerState>,
) -> (StatusCode, Json<Value>) {
    let start = std::time::Instant::now();
    let path = uri.path().to_string();

    // First pass: find matching endpoint and extract needed data
    let match_result = {
        let endpoints = state.endpoints.read().unwrap();
        let settings = state.settings.read().unwrap();

        let mut found = None;
        for endpoint in endpoints.iter() {
            if endpoint.method != method.as_str().to_uppercase() {
                continue;
            }

            if endpoint.path_regex.is_match(&path) {
                let delay_key = format!(
                    "{}_{}",
                    endpoint.collection_id,
                    endpoint
                        .endpoint
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                );

                let delay = settings.endpoint_delays.get(&delay_key).copied();
                let custom_response = settings.custom_responses.get(&delay_key).cloned();
                let custom_status = settings.custom_status_codes.get(&delay_key).copied();
                let endpoint_data = endpoint.endpoint.clone();
                let matched_info = MatchedEndpointInfo {
                    collection_id: endpoint.collection_id.clone(),
                    collection_name: endpoint.collection_name.clone(),
                    endpoint_id: endpoint
                        .endpoint
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    endpoint_name: endpoint
                        .endpoint
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                };

                found = Some((
                    delay_key,
                    delay,
                    custom_response,
                    custom_status,
                    endpoint_data,
                    matched_info,
                ));
                break;
            }
        }
        found
    };

    // Process the match
    if let Some((_delay_key, delay, custom_response, custom_status, endpoint_data, matched_info)) =
        match_result
    {
        // Apply delay if configured
        if let Some(delay_ms) = delay {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }

        let response = custom_response.unwrap_or_else(|| generate_mock_response(&endpoint_data));
        let status_code = custom_status.unwrap_or(200);

        // Log request
        let log = RequestLog {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            method: method.to_string(),
            path: path.clone(),
            query,
            response_status: status_code,
            response_time: start.elapsed().as_millis() as u64,
            matched_endpoint: Some(matched_info),
        };

        push_log(&state, log);

        return (
            StatusCode::from_u16(status_code).unwrap_or(StatusCode::OK),
            Json(response),
        );
    }

    // 404 - Not found
    let log = RequestLog {
        id: Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        method: method.to_string(),
        path: path.clone(),
        query,
        response_status: 404,
        response_time: start.elapsed().as_millis() as u64,
        matched_endpoint: None,
    };

    push_log(&state, log);

    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "error": "Endpoint not found",
            "path": path,
            "method": method.to_string()
        })),
    )
}

fn generate_mock_response(endpoint: &Value) -> Value {
    // Try to find response schema and generate example. The media-type key
    // contains a slash, so the JSON pointer needs the ~1 escape; the unescaped
    // variant is kept for responses stored as nested objects.
    if let Some(responses) = endpoint.get("responses") {
        for code in ["200", "201", "202", "204"] {
            if let Some(response) = responses.get(code) {
                if let Some(example) = response
                    .pointer("/content/application~1json/example")
                    .or_else(|| response.pointer("/content/application/json/example"))
                {
                    return example.clone();
                }
                if let Some(schema) = response
                    .pointer("/content/application~1json/schema")
                    .or_else(|| response.pointer("/content/application/json/schema"))
                {
                    return generate_from_schema(schema);
                }
            }
        }
    }

    // Fallback
    serde_json::json!({
        "message": "Mock response",
        "success": true,
        "timestamp": chrono::Utc::now().to_rfc3339()
    })
}

fn generate_from_schema(schema: &Value) -> Value {
    if let Some(example) = crate::commands::import_export::schema_example(schema) {
        return example;
    }
    match crate::commands::import_export::primary_type(schema) {
        Some("object") => {
            let mut obj = serde_json::Map::new();
            if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
                for (key, prop_schema) in properties {
                    obj.insert(key.clone(), generate_from_schema(prop_schema));
                }
            }
            Value::Object(obj)
        }
        Some("array") => {
            let item = schema
                .get("items")
                .map(generate_from_schema)
                .unwrap_or(Value::Null);
            Value::Array(vec![item])
        }
        Some("string") => Value::String("string".to_string()),
        Some("integer") | Some("number") => Value::Number(serde_json::Number::from(0)),
        Some("boolean") => Value::Bool(true),
        _ => Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn empty_state() -> MockServerState {
        MockServerState {
            endpoints: Arc::new(RwLock::new(Vec::new())),
            settings: Arc::new(RwLock::new(MockServerSettings {
                port: 0,
                endpoint_delays: HashMap::new(),
                custom_responses: HashMap::new(),
                custom_status_codes: HashMap::new(),
            })),
            logs: Arc::new(RwLock::new(Vec::new())),
        }
    }

    #[tokio::test]
    async fn router_does_not_reflect_cross_origin() {
        let response = build_router(empty_state())
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/anything")
                    .header("Origin", "https://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
        assert!(
            response
                .headers()
                .get("access-control-allow-credentials")
                .is_none()
        );
    }

    #[tokio::test]
    async fn preflight_is_not_granted_cross_origin_access() {
        let response = build_router(empty_state())
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/anything")
                    .header("Origin", "https://evil.example")
                    .header("Access-Control-Request-Method", "GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
        assert!(
            response
                .headers()
                .get("access-control-allow-methods")
                .is_none()
        );
    }

    #[test]
    fn schema_derived_body_reaches_the_escaped_media_type_key() {
        let endpoint = serde_json::json!({
            "responses": {
                "200": {
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": { "id": { "type": "integer" } }
                            }
                        }
                    }
                }
            }
        });

        assert_eq!(
            generate_mock_response(&endpoint),
            serde_json::json!({ "id": 0 })
        );
    }

    #[test]
    fn schema_generation_handles_type_arrays_and_const() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": ["string", "null"] },
                "kind": { "const": "widget" },
                "count": { "type": ["integer", "null"], "examples": [7] }
            }
        });

        assert_eq!(
            generate_from_schema(&schema),
            serde_json::json!({ "name": "string", "kind": "widget", "count": 7 })
        );
    }

    fn collection(endpoints: Vec<Value>) -> Value {
        serde_json::json!({ "id": "c1", "name": "C", "endpoints": endpoints })
    }

    fn endpoint(id: &str, method: &str, path: &str) -> Value {
        serde_json::json!({ "id": id, "name": id, "method": method, "path": path })
    }

    fn state_with(endpoints: Vec<Value>) -> MockServerState {
        let state = empty_state();
        *state.endpoints.write().unwrap() = build_routing_table(&[collection(endpoints)]);
        state
    }

    async fn call(state: &MockServerState, method: &str, uri: &str) -> (StatusCode, Value) {
        let response = build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    fn matched_id(state: &MockServerState) -> Option<String> {
        state
            .logs
            .read()
            .unwrap()
            .last()
            .and_then(|log| log.matched_endpoint.as_ref())
            .map(|m| m.endpoint_id.clone())
    }

    #[test]
    fn normalizes_absolute_urls_and_host_tokens() {
        assert_eq!(
            normalize_mock_path("https://api.example.com/users/1?x=1"),
            "/users/1"
        );
        assert_eq!(normalize_mock_path("http://localhost:8080"), "/");
        assert_eq!(normalize_mock_path("{{baseUrl}}/users"), "/users");
        assert_eq!(normalize_mock_path("{{baseUrl}}"), "/");
        assert_eq!(normalize_mock_path("users/{id}"), "/users/{id}");
        assert_eq!(
            normalize_mock_path("/users/{{userId}}"),
            "/users/{{userId}}"
        );
    }

    #[tokio::test]
    async fn double_brace_and_colon_params_match() {
        let state = state_with(vec![
            endpoint("a", "GET", "/users/{{userId}}"),
            endpoint("b", "GET", "/orders/:orderId/items"),
        ]);
        assert_eq!(call(&state, "GET", "/users/42").await.0, StatusCode::OK);
        assert_eq!(matched_id(&state).as_deref(), Some("a"));
        assert_eq!(
            call(&state, "GET", "/orders/7/items").await.0,
            StatusCode::OK
        );
        assert_eq!(matched_id(&state).as_deref(), Some("b"));
    }

    #[tokio::test]
    async fn absolute_url_paths_from_curl_imports_match() {
        let state = state_with(vec![endpoint("a", "POST", "https://api.example.com/login")]);
        assert_eq!(call(&state, "POST", "/login").await.0, StatusCode::OK);
    }

    #[tokio::test]
    async fn literal_route_beats_parameter_route_regardless_of_order() {
        let state = state_with(vec![
            endpoint("param", "GET", "/users/{id}"),
            endpoint("me", "GET", "/users/me"),
        ]);
        call(&state, "GET", "/users/me").await;
        assert_eq!(matched_id(&state).as_deref(), Some("me"));
        call(&state, "GET", "/users/9").await;
        assert_eq!(matched_id(&state).as_deref(), Some("param"));
    }

    #[tokio::test]
    async fn dots_in_paths_are_literal() {
        let state = state_with(vec![endpoint("a", "GET", "/v1.0/status")]);
        assert_eq!(call(&state, "GET", "/v1.0/status").await.0, StatusCode::OK);
        assert_eq!(
            call(&state, "GET", "/v1x0/status").await.0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn root_path_is_served() {
        let state = state_with(vec![endpoint("root", "GET", "/")]);
        assert_eq!(call(&state, "GET", "/").await.0, StatusCode::OK);
        assert_eq!(matched_id(&state).as_deref(), Some("root"));
    }

    #[tokio::test]
    async fn unmatched_request_log_stays_capped() {
        let state = state_with(vec![endpoint("a", "GET", "/a")]);
        for _ in 0..(MAX_LOGS + 20) {
            call(&state, "GET", "/missing").await;
        }
        assert_eq!(state.logs.read().unwrap().len(), MAX_LOGS);
    }
}
