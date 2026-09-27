use axum::{
    Router,
    body::Bytes,
    extract::{Query, State as AxumState},
    http::{HeaderMap, Method, StatusCode, Uri},
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
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    let start = std::time::Instant::now();
    let path = uri.path().to_string();

    let match_result = {
        let endpoints = state.endpoints.read().unwrap();
        let settings = state.settings.read().unwrap();

        endpoints
            .iter()
            .filter(|endpoint| endpoint.method == method.as_str().to_uppercase())
            .find_map(|endpoint| {
                let captures = endpoint.path_regex.captures(&path)?;
                let params: HashMap<String, String> = endpoint
                    .param_names
                    .iter()
                    .enumerate()
                    .filter_map(|(index, name)| {
                        captures
                            .get(index + 1)
                            .map(|m| (name.clone(), percent_decode(m.as_str())))
                    })
                    .collect();
                let endpoint_id = endpoint
                    .endpoint
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let key = format!("{}_{}", endpoint.collection_id, endpoint_id);
                Some(MatchedRoute {
                    delay: settings.endpoint_delays.get(&key).copied(),
                    custom_response: settings.custom_responses.get(&key).cloned(),
                    custom_status: settings.custom_status_codes.get(&key).copied(),
                    endpoint: endpoint.endpoint.clone(),
                    params,
                    info: MatchedEndpointInfo {
                        collection_id: endpoint.collection_id.clone(),
                        collection_name: endpoint.collection_name.clone(),
                        endpoint_name: endpoint
                            .endpoint
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        endpoint_id,
                    },
                })
            })
    };

    let Some(route) = match_result else {
        push_log(
            &state,
            RequestLog {
                id: Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                method: method.to_string(),
                path: path.clone(),
                query,
                response_status: 404,
                response_time: start.elapsed().as_millis() as u64,
                matched_endpoint: None,
            },
        );
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "Endpoint not found",
                "path": path,
                "method": method.to_string()
            })),
        );
    };

    if let Some(delay_ms) = route.delay {
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
    }

    let prefer = parse_prefer(&headers);
    let (status_code, template) = if prefer.code.is_some() || prefer.example.is_some() {
        let (code, body) =
            select_mock_response(&route.endpoint, prefer.code, prefer.example.as_deref());
        (code.unwrap_or(200), body)
    } else {
        let (spec_code, spec_body) = select_mock_response(&route.endpoint, None, None);
        (
            route.custom_status.or(spec_code).unwrap_or(200),
            route.custom_response.unwrap_or(spec_body),
        )
    };

    let body_text = String::from_utf8_lossy(&body).into_owned();
    let context = TemplateContext {
        method: method.to_string(),
        path: path.clone(),
        params: route.params,
        query: query.clone(),
        headers,
        body_json: serde_json::from_str(&body_text).ok(),
        body_text,
    };
    let response = render_template(&template, &context);

    push_log(
        &state,
        RequestLog {
            id: Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            method: method.to_string(),
            path,
            query,
            response_status: status_code,
            response_time: start.elapsed().as_millis() as u64,
            matched_endpoint: Some(route.info),
        },
    );

    (
        StatusCode::from_u16(status_code).unwrap_or(StatusCode::OK),
        Json(response),
    )
}

struct MatchedRoute {
    delay: Option<u64>,
    custom_response: Option<Value>,
    custom_status: Option<u16>,
    endpoint: Value,
    params: HashMap<String, String>,
    info: MatchedEndpointInfo,
}

fn percent_decode(text: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", text.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| text.to_string())
}

#[derive(Default)]
struct Prefer {
    code: Option<u16>,
    example: Option<String>,
}

/// Reads a Prism-style `Prefer: code=404, example=notFound` header, which lets
/// a client pick one of the spec's documented responses per request.
fn parse_prefer(headers: &HeaderMap) -> Prefer {
    let mut prefer = Prefer::default();
    for value in headers.get_all("prefer") {
        let Ok(text) = value.to_str() else { continue };
        for part in text.split([',', ';']) {
            let Some((key, val)) = part.split_once('=') else {
                continue;
            };
            let val = val.trim().trim_matches('"');
            match key.trim().to_ascii_lowercase().as_str() {
                "code" => prefer.code = val.parse().ok(),
                "example" => prefer.example = Some(val.to_string()),
                _ => {}
            }
        }
    }
    prefer
}

fn json_content(response: &Value) -> Option<&Value> {
    response
        .pointer("/content/application~1json")
        .or_else(|| response.pointer("/content/application/json"))
}

/// Body for one documented response: the named example when asked for one,
/// else the single `example`, else the first of `examples`, else a body
/// generated from the schema.
fn body_for_response(response: &Value, example_name: Option<&str>) -> Option<Value> {
    let content = json_content(response)?;
    let examples = content.get("examples").and_then(|e| e.as_object());
    if let (Some(name), Some(examples)) = (example_name, examples)
        && let Some(named) = examples.get(name)
    {
        return Some(named.get("value").cloned().unwrap_or_else(|| named.clone()));
    }
    if let Some(example) = content.get("example") {
        return Some(example.clone());
    }
    if let Some(first) = examples.and_then(|e| e.values().next()) {
        return Some(first.get("value").cloned().unwrap_or_else(|| first.clone()));
    }
    content.get("schema").map(generate_from_schema)
}

/// Chooses the status and body to mock from the endpoint's documented
/// responses. Without a preference the first success response wins.
fn select_mock_response(
    endpoint: &Value,
    prefer_code: Option<u16>,
    prefer_example: Option<&str>,
) -> (Option<u16>, Value) {
    let responses = endpoint.get("responses").and_then(|r| r.as_object());

    if let Some(code) = prefer_code {
        let body = responses
            .and_then(|r| r.get(&code.to_string()))
            .and_then(|response| body_for_response(response, prefer_example))
            .unwrap_or_else(|| serde_json::json!({ "message": format!("No documented body for status {code}") }));
        return (Some(code), body);
    }

    if let Some(responses) = responses {
        let mut codes: Vec<&String> = responses.keys().filter(|c| c.starts_with('2')).collect();
        codes.sort();
        if let Some(name) = prefer_example
            && let Some((code, body)) = responses.iter().find_map(|(code, response)| {
                json_content(response)
                    .and_then(|c| c.get("examples"))
                    .and_then(|e| e.get(name))
                    .map(|_| (code, body_for_response(response, Some(name))))
            })
        {
            return (code.parse().ok(), body.unwrap_or(Value::Null));
        }
        for code in codes {
            if let Some(body) = body_for_response(&responses[code], None) {
                return (code.parse().ok(), body);
            }
        }
    }

    (
        None,
        serde_json::json!({
            "message": "Mock response",
            "success": true,
            "timestamp": chrono::Utc::now().to_rfc3339()
        }),
    )
}

#[cfg(test)]
fn generate_mock_response(endpoint: &Value) -> Value {
    select_mock_response(endpoint, None, None).1
}

struct TemplateContext {
    method: String,
    path: String,
    params: HashMap<String, String>,
    query: HashMap<String, String>,
    headers: HeaderMap,
    body_text: String,
    body_json: Option<Value>,
}

static PLACEHOLDER: std::sync::LazyLock<Regex> =
    std::sync::LazyLock::new(|| Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").unwrap());

fn random_u32() -> u32 {
    let bytes = Uuid::new_v4().into_bytes();
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// Resolves one placeholder expression against the incoming request, or the
/// dynamic values `$uuid`, `$timestamp`, `$isoTimestamp` and `$randomInt`.
fn lookup_placeholder(expr: &str, ctx: &TemplateContext) -> Option<Value> {
    match expr {
        "$uuid" | "$guid" | "$randomUUID" => return Some(Value::from(Uuid::new_v4().to_string())),
        "$timestamp" => return Some(Value::from(chrono::Utc::now().timestamp())),
        "$isoTimestamp" => return Some(Value::from(chrono::Utc::now().to_rfc3339())),
        "$randomInt" => return Some(Value::from(random_u32() % 1001)),
        "request.method" => return Some(Value::from(ctx.method.clone())),
        "request.path" => return Some(Value::from(ctx.path.clone())),
        "request.body" => {
            return Some(
                ctx.body_json
                    .clone()
                    .unwrap_or_else(|| Value::from(ctx.body_text.clone())),
            );
        }
        _ => {}
    }
    if let Some(name) = expr.strip_prefix("request.params.") {
        return ctx.params.get(name).map(|v| Value::from(v.clone()));
    }
    if let Some(name) = expr.strip_prefix("request.query.") {
        return ctx.query.get(name).map(|v| Value::from(v.clone()));
    }
    if let Some(name) = expr.strip_prefix("request.headers.") {
        return ctx
            .headers
            .get(name.to_ascii_lowercase())
            .and_then(|v| v.to_str().ok())
            .map(|v| Value::from(v.to_string()));
    }
    if let Some(path) = expr.strip_prefix("request.body.") {
        let mut current = ctx.body_json.as_ref()?;
        for part in path.split('.') {
            current = match current {
                Value::Array(items) => items.get(part.parse::<usize>().ok()?)?,
                Value::Object(map) => map.get(part)?,
                _ => return None,
            };
        }
        return Some(current.clone());
    }
    None
}

fn value_as_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// Fills `{{…}}` placeholders in every string of a response body. A string
/// that is exactly one placeholder takes the value's JSON type, so
/// `"{{request.body.count}}"` stays a number; unknown placeholders are kept.
fn render_template(value: &Value, ctx: &TemplateContext) -> Value {
    match value {
        Value::String(text) => {
            if let Some(caps) = PLACEHOLDER.captures(text)
                && caps.get(0).map(|m| m.as_str().len()) == Some(text.len())
                && let Some(found) = lookup_placeholder(&caps[1], ctx)
            {
                return found;
            }
            let rendered = PLACEHOLDER.replace_all(text, |caps: &regex::Captures| {
                lookup_placeholder(&caps[1], ctx)
                    .map(|v| value_as_text(&v))
                    .unwrap_or_else(|| caps[0].to_string())
            });
            Value::String(rendered.into_owned())
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(|v| render_template(v, ctx)).collect())
        }
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), render_template(v, ctx)))
                .collect(),
        ),
        other => other.clone(),
    }
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

    async fn call_with(
        state: &MockServerState,
        method: &str,
        uri: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let response = build_router(state.clone())
            .oneshot(builder.body(Body::from(body.to_string())).unwrap())
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

    fn state_with_custom(endpoints: Vec<Value>, custom: Value) -> MockServerState {
        let state = state_with(endpoints);
        state
            .settings
            .write()
            .unwrap()
            .custom_responses
            .insert("c1_e1".to_string(), custom);
        state
    }

    #[tokio::test]
    async fn templates_echo_the_request_and_keep_json_types() {
        let state = state_with_custom(
            vec![endpoint("e1", "POST", "/users/{id}/orders")],
            serde_json::json!({
                "userId": "{{request.params.id}}",
                "sort": "{{request.query.sort}}",
                "trace": "trace-{{request.headers.X-Trace}}",
                "count": "{{request.body.items.1.qty}}",
                "echo": "{{request.body}}",
                "method": "{{request.method}} {{request.path}}",
                "id": "{{$uuid}}",
                "unknown": "{{nope}}"
            }),
        );

        let (status, body) = call_with(
            &state,
            "POST",
            "/users/42/orders?sort=asc",
            &[("x-trace", "abc"), ("content-type", "application/json")],
            r#"{"items":[{"qty":1},{"qty":3}]}"#,
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["userId"], "42");
        assert_eq!(body["sort"], "asc");
        assert_eq!(body["trace"], "trace-abc");
        assert_eq!(body["count"], 3);
        assert_eq!(body["echo"]["items"][0]["qty"], 1);
        assert_eq!(body["method"], "POST /users/42/orders");
        assert_eq!(body["id"].as_str().unwrap().len(), 36);
        assert_eq!(body["unknown"], "{{nope}}");
    }

    fn documented() -> Value {
        serde_json::json!({
            "id": "e1", "name": "Get user", "method": "GET", "path": "/users/{id}",
            "responses": {
                "201": { "content": { "application/json": { "example": { "created": true } } } },
                "404": { "content": { "application/json": { "examples": {
                    "missing": { "value": { "error": "no such user {{request.params.id}}" } },
                    "gone": { "value": { "error": "deleted" } }
                } } } }
            }
        })
    }

    #[tokio::test]
    async fn the_documented_success_status_is_used_by_default() {
        let state = state_with(vec![documented()]);
        let (status, body) = call_with(&state, "GET", "/users/1", &[], "").await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(body, serde_json::json!({ "created": true }));
    }

    #[tokio::test]
    async fn a_prefer_header_selects_a_documented_status_and_example() {
        let state = state_with(vec![documented()]);

        let (status, body) =
            call_with(&state, "GET", "/users/9", &[("prefer", "code=404")], "").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "no such user 9");

        let (status, body) = call_with(
            &state,
            "GET",
            "/users/9",
            &[("prefer", "code=404, example=gone")],
            "",
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "deleted");

        let (status, body) =
            call_with(&state, "GET", "/users/9", &[("prefer", "example=gone")], "").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "deleted");
    }

    #[tokio::test]
    async fn a_prefer_header_wins_over_the_custom_response() {
        let mut ep = documented();
        ep["id"] = serde_json::json!("e1");
        let state = state_with_custom(vec![ep], serde_json::json!({ "custom": true }));

        let (_, plain) = call_with(&state, "GET", "/users/1", &[], "").await;
        assert_eq!(plain, serde_json::json!({ "custom": true }));

        let (status, _) = call_with(&state, "GET", "/users/1", &[("prefer", "code=404")], "").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[test]
    fn encoded_path_params_are_decoded() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a+b"), "a+b");
    }
}
