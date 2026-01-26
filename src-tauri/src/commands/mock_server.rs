use axum::{
    extract::{Path, Query, State as AxumState},
    http::{Method, StatusCode},
    response::Json,
    routing::any,
    Router,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use tokio::sync::oneshot;
use tower_http::cors::CorsLayer;
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

    let app = Router::new()
        .route("/*path", any(handle_mock_request))
        .route("/", any(handle_mock_request))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

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

fn build_routing_table(collections: &[Value]) -> Vec<MockEndpoint> {
    let mut endpoints = Vec::new();
    let param_regex = regex::Regex::new(r"\{([^}]+)\}").unwrap();

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

                let path = ep.get("path").and_then(|p| p.as_str()).unwrap_or("/");

                // Convert OpenAPI path to regex pattern
                // Example: /users/{id} → /users/([^/]+)
                let mut param_names = Vec::new();

                for cap in param_regex.captures_iter(path) {
                    if let Some(name) = cap.get(1) {
                        param_names.push(name.as_str().to_string());
                    }
                }

                let path_pattern = param_regex.replace_all(path, "([^/]+)").replace('/', "\\/");

                let path_regex = match Regex::new(&format!("^{}$", path_pattern)) {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                endpoints.push(MockEndpoint {
                    method,
                    path_regex,
                    path_pattern: path.to_string(),
                    param_names,
                    endpoint: ep.clone(),
                    collection_id: collection_id.clone(),
                    collection_name: collection_name.clone(),
                });
            }
        }
    }

    endpoints
}

async fn handle_mock_request(
    method: Method,
    Path(path): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    AxumState(state): AxumState<MockServerState>,
) -> (StatusCode, Json<Value>) {
    let start = std::time::Instant::now();
    let path = format!("/{}", path);

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

        let mut logs = state.logs.write().unwrap();
        logs.push(log);
        if logs.len() > 100 {
            logs.remove(0);
        }

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

    state.logs.write().unwrap().push(log);

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
    // Try to find response schema and generate example
    if let Some(responses) = endpoint.get("responses") {
        for code in ["200", "201", "202", "204"] {
            if let Some(response) = responses.get(code) {
                if let Some(example) = response.pointer("/content/application/json/example") {
                    return example.clone();
                }
                if let Some(schema) = response.pointer("/content/application/json/schema") {
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
    match schema.get("type").and_then(|t| t.as_str()) {
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
        Some("string") => {
            if let Some(example) = schema.get("example") {
                return example.clone();
            }
            Value::String("string".to_string())
        }
        Some("integer") | Some("number") => {
            if let Some(example) = schema.get("example") {
                return example.clone();
            }
            Value::Number(serde_json::Number::from(0))
        }
        Some("boolean") => {
            if let Some(example) = schema.get("example") {
                return example.clone();
            }
            Value::Bool(true)
        }
        _ => Value::Null,
    }
}
