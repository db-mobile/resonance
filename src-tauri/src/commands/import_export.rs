use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;

const STORE_FILE: &str = "resonance-store.json";
const LAST_IMPORT_DIR_KEY: &str = "lastImportDirectory";

fn is_http_method(method: &str) -> bool {
    matches!(
        method.to_ascii_uppercase().as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
    )
}

/// Get the last used import directory from the store
fn get_last_import_directory(app: &AppHandle) -> Option<std::path::PathBuf> {
    let store = app.store(STORE_FILE).ok()?;
    let dir_str = store.get(LAST_IMPORT_DIR_KEY)?.as_str()?.to_string();
    if dir_str.is_empty() {
        return None;
    }
    let path = std::path::PathBuf::from(dir_str);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Save the directory of a selected file to the store for next time
fn save_last_import_directory(app: &AppHandle, file_path: &std::path::Path) {
    if let Some(parent) = file_path.parent() {
        if let Ok(store) = app.store(STORE_FILE) {
            store.set(
                LAST_IMPORT_DIR_KEY.to_string(),
                serde_json::Value::String(parent.to_string_lossy().to_string()),
            );
            let _ = store.save();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub base_url: Option<String>,
    pub endpoints: Vec<Endpoint>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    pub variables: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub endpoints: Vec<Endpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub id: String,
    pub name: String,
    pub method: String,
    pub path: String,
    pub description: Option<String>,
    /// Parameters grouped by location: { path: {...}, query: {...}, header: {...} }
    pub parameters: Option<Value>,
    pub request_body: Option<Value>,
    pub responses: Option<HashMap<String, Value>>,
    /// Authentication configuration: { type: "bearer"|"basic"|"api-key"|"digest", config: {...} }
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<Value>,
}

#[tauri::command]
pub async fn import_openapi_file(app: AppHandle) -> Result<Option<Collection>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .add_filter("OpenAPI Files", &["yml", "yaml", "json"]);

    // Set starting directory to last used location
    if let Some(last_dir) = get_last_import_directory(&app) {
        dialog = dialog.set_directory(last_dir);
    }

    dialog.pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(None);
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;

    // Save the directory for next time
    save_last_import_directory(&app, file_path);
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse as YAML (also handles JSON)
    let spec: Value = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse OpenAPI spec: {}", e))?;

    // Convert OpenAPI spec to Collection
    let collection = parse_openapi_spec(spec)?;

    // Save to store
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let mut collections: Vec<Collection> = store
        .get("collections")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    collections.push(collection.clone());
    store.set(
        "collections".to_string(),
        serde_json::to_value(&collections).unwrap(),
    );

    // Save baseUrl as a collection variable if present
    if let Some(base_url) = &collection.base_url {
        let mut collection_variables: HashMap<String, HashMap<String, String>> = store
            .get("collectionVariables")
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        let vars = collection_variables
            .entry(collection.id.clone())
            .or_default();
        vars.insert("baseUrl".to_string(), base_url.clone());

        store.set(
            "collectionVariables".to_string(),
            serde_json::to_value(&collection_variables).unwrap(),
        );
    }

    store.save().map_err(|e| e.to_string())?;

    Ok(Some(collection))
}

fn parse_openapi_spec(spec: Value) -> Result<Collection, String> {
    let info = spec.get("info").ok_or("Missing 'info' in OpenAPI spec")?;
    let paths = spec.get("paths").ok_or("Missing 'paths' in OpenAPI spec")?;

    let name = info
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Collection")
        .to_string();

    let description = info
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract base URL from servers
    let base_url = spec
        .get("servers")
        .and_then(|s| s.as_array())
        .and_then(|arr| arr.first())
        .and_then(|s| s.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    // Group endpoints by base path (first segment of the path)
    let mut grouped_endpoints: HashMap<String, Vec<Endpoint>> = HashMap::new();

    if let Some(paths_obj) = paths.as_object() {
        for (path, methods) in paths_obj {
            if let Some(methods_obj) = methods.as_object() {
                for (method, operation) in methods_obj {
                    if !["get", "post", "put", "patch", "delete", "head", "options"]
                        .contains(&method.as_str())
                    {
                        continue;
                    }

                    let endpoint = Endpoint {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: operation
                            .get("summary")
                            .or_else(|| operation.get("operationId"))
                            .and_then(|v| v.as_str())
                            .unwrap_or(path)
                            .to_string(),
                        method: method.to_uppercase(),
                        path: path.clone(),
                        description: operation
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        parameters: parse_parameters(operation.get("parameters"), &spec),
                        request_body: extract_openapi_request_body(
                            operation.get("requestBody"),
                            &spec,
                        ),
                        responses: operation
                            .get("responses")
                            .and_then(|r| r.as_object())
                            .map(|obj| obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
                        security: extract_openapi_security(operation.get("security"), &spec),
                    };

                    // Extract base path (first segment) for folder grouping
                    let base_path = extract_base_path(path);
                    grouped_endpoints
                        .entry(base_path)
                        .or_default()
                        .push(endpoint);
                }
            }
        }
    }

    // Create folders from grouped endpoints
    let mut folders: Vec<Folder> = grouped_endpoints
        .into_iter()
        .map(|(base_path, endpoints)| Folder {
            id: format!(
                "folder_{}",
                base_path.replace(|c: char| !c.is_alphanumeric(), "_")
            ),
            name: base_path,
            endpoints,
        })
        .collect();

    // Sort folders by name for consistent ordering
    folders.sort_by(|a, b| a.name.cmp(&b.name));

    // Flatten all endpoints for the endpoints array
    let all_endpoints: Vec<Endpoint> = folders.iter().flat_map(|f| f.endpoints.clone()).collect();

    Ok(Collection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        base_url,
        endpoints: all_endpoints,
        folders,
        variables: None,
    })
}

/// Extract the base path (first segment) from a full path for folder grouping
fn extract_base_path(path: &str) -> String {
    let clean_path = path.trim_start_matches('/');
    let segments: Vec<&str> = clean_path.split('/').collect();
    segments.first().unwrap_or(&"root").to_string()
}

/// Extract and process OpenAPI requestBody into format expected by frontend
fn extract_openapi_request_body(request_body: Option<&Value>, spec: &Value) -> Option<Value> {
    let rb = request_body?;

    // Get schema from content.application/json.schema
    let schema = rb
        .pointer("/content/application/json/schema")
        .or_else(|| rb.pointer("/content/application~1json/schema")) // Handle escaped slash
        .cloned();

    // Check for example at various levels
    let example = rb
        .pointer("/content/application/json/example")
        .or_else(|| rb.pointer("/content/application~1json/example"))
        .cloned();

    if let Some(ex) = example {
        // If there's a direct example, use it
        let example_str = if ex.is_string() {
            ex.as_str().unwrap_or("").to_string()
        } else {
            serde_json::to_string_pretty(&ex).unwrap_or_default()
        };
        return Some(serde_json::json!({ "example": example_str }));
    }

    if let Some(schema) = schema {
        // Resolve $ref if present and generate example from schema
        let resolved = resolve_schema_ref(&schema, spec);
        let example_json = generate_example_from_schema(&resolved, spec);
        let example_str = serde_json::to_string_pretty(&example_json).unwrap_or_default();

        return Some(serde_json::json!({
            "schema": resolved,
            "example": example_str
        }));
    }

    // Check if required flag is set
    if rb
        .get("required")
        .and_then(|r| r.as_bool())
        .unwrap_or(false)
    {
        return Some(serde_json::json!({ "required": true }));
    }

    None
}

/// Resolve $ref in OpenAPI schema
fn resolve_schema_ref(schema: &Value, spec: &Value) -> Value {
    if let Some(ref_path) = schema.get("$ref").and_then(|r| r.as_str()) {
        // Parse ref like "#/components/schemas/Post"
        if ref_path.starts_with("#/") {
            let _path = ref_path.trim_start_matches("#/").replace('/', "~1");
            let json_pointer = format!("/{}", ref_path.trim_start_matches("#/"));
            if let Some(resolved) = spec.pointer(&json_pointer) {
                return resolved.clone();
            }
        }
    }
    schema.clone()
}

/// Generate example JSON from OpenAPI schema
fn generate_example_from_schema(schema: &Value, spec: &Value) -> Value {
    // Handle $ref
    if schema.get("$ref").is_some() {
        let resolved = resolve_schema_ref(schema, spec);
        return generate_example_from_schema(&resolved, spec);
    }

    let schema_type = schema
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("object");

    match schema_type {
        "object" => {
            let mut obj = serde_json::Map::new();
            if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
                for (key, prop_schema) in properties {
                    // Check for example in property
                    if let Some(example) = prop_schema.get("example") {
                        obj.insert(key.clone(), example.clone());
                    } else {
                        obj.insert(key.clone(), generate_example_from_schema(prop_schema, spec));
                    }
                }
            }
            Value::Object(obj)
        }
        "array" => {
            if let Some(items) = schema.get("items") {
                Value::Array(vec![generate_example_from_schema(items, spec)])
            } else {
                Value::Array(vec![])
            }
        }
        "string" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                Value::String("string".to_string())
            }
        }
        "integer" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                Value::Number(serde_json::Number::from(0))
            }
        }
        "number" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                serde_json::json!(0.0)
            }
        }
        "boolean" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                Value::Bool(false)
            }
        }
        _ => Value::Null,
    }
}

/// Parse OpenAPI parameters array into grouped object: { path: {...}, query: {...}, header: {...} }
/// Resolves $ref references to components/parameters
fn parse_parameters(params: Option<&Value>, spec: &Value) -> Option<Value> {
    let arr = params.and_then(|p| p.as_array())?;

    let mut path_params: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut query_params: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut header_params: serde_json::Map<String, Value> = serde_json::Map::new();

    for param in arr {
        // Resolve $ref if present (e.g., "$ref": "#/components/parameters/acceptLanguage")
        let resolved_param = if let Some(ref_path) = param.get("$ref").and_then(|r| r.as_str()) {
            if ref_path.starts_with("#/") {
                let json_pointer = format!("/{}", ref_path.trim_start_matches("#/"));
                spec.pointer(&json_pointer).unwrap_or(param)
            } else {
                param
            }
        } else {
            param
        };

        let name = resolved_param
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let location = resolved_param
            .get("in")
            .and_then(|l| l.as_str())
            .unwrap_or_default();

        if name.is_empty() {
            continue;
        }

        // Build parameter object with example value
        let mut param_obj = serde_json::Map::new();

        // Extract example from schema or use default
        let example = resolved_param
            .get("schema")
            .and_then(|s| s.get("example"))
            .or_else(|| resolved_param.get("example"))
            .cloned()
            .unwrap_or_else(|| {
                // Generate default based on schema type
                if let Some(schema_type) = resolved_param
                    .get("schema")
                    .and_then(|s| s.get("type"))
                    .and_then(|t| t.as_str())
                {
                    match schema_type {
                        "integer" | "number" => Value::String("0".to_string()),
                        "boolean" => Value::String("true".to_string()),
                        _ => Value::String(String::new()),
                    }
                } else {
                    Value::String(String::new())
                }
            });

        // Convert example to string if needed
        let example_str = match &example {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => example.to_string(),
        };

        param_obj.insert("example".to_string(), Value::String(example_str));

        if let Some(desc) = resolved_param.get("description").and_then(|d| d.as_str()) {
            param_obj.insert("description".to_string(), Value::String(desc.to_string()));
        }

        if let Some(required) = resolved_param.get("required").and_then(|r| r.as_bool()) {
            param_obj.insert("required".to_string(), Value::Bool(required));
        }

        if let Some(schema) = resolved_param.get("schema") {
            param_obj.insert("schema".to_string(), schema.clone());
        }

        match location {
            "path" => {
                path_params.insert(name.to_string(), Value::Object(param_obj));
            }
            "query" => {
                query_params.insert(name.to_string(), Value::Object(param_obj));
            }
            "header" => {
                header_params.insert(name.to_string(), Value::Object(param_obj));
            }
            _ => {}
        }
    }

    // Only return if we have any parameters
    if path_params.is_empty() && query_params.is_empty() && header_params.is_empty() {
        return None;
    }

    let mut result = serde_json::Map::new();
    if !path_params.is_empty() {
        result.insert("path".to_string(), Value::Object(path_params));
    }
    if !query_params.is_empty() {
        result.insert("query".to_string(), Value::Object(query_params));
    }
    if !header_params.is_empty() {
        result.insert("header".to_string(), Value::Object(header_params));
    }

    Some(Value::Object(result))
}

/// Extract security configuration from OpenAPI operation
/// Converts OpenAPI security requirements to { type, config } format expected by frontend
fn extract_openapi_security(security: Option<&Value>, spec: &Value) -> Option<Value> {
    let security_arr = security?.as_array()?;

    // Get the first security requirement
    let first_req = security_arr.first()?.as_object()?;
    let (scheme_name, _scopes) = first_req.iter().next()?;

    // Look up the security scheme in components/securitySchemes
    let scheme = spec
        .pointer(&format!("/components/securitySchemes/{}", scheme_name))?
        .as_object()?;

    let scheme_type = scheme.get("type").and_then(|t| t.as_str())?;

    match scheme_type {
        "http" => {
            let http_scheme = scheme
                .get("scheme")
                .and_then(|s| s.as_str())
                .unwrap_or("bearer");
            match http_scheme {
                "bearer" => Some(serde_json::json!({
                    "type": "bearer",
                    "config": {
                        "token": ""
                    }
                })),
                "basic" => Some(serde_json::json!({
                    "type": "basic",
                    "config": {
                        "username": "",
                        "password": ""
                    }
                })),
                "digest" => Some(serde_json::json!({
                    "type": "digest",
                    "config": {
                        "username": "",
                        "password": ""
                    }
                })),
                _ => None,
            }
        }
        "apiKey" => {
            let key_name = scheme
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("api_key");
            let location = scheme
                .get("in")
                .and_then(|i| i.as_str())
                .unwrap_or("header");

            Some(serde_json::json!({
                "type": "api-key",
                "config": {
                    "keyName": key_name,
                    "keyValue": "",
                    "location": location
                }
            }))
        }
        _ => None,
    }
}

#[tauri::command]
pub async fn import_postman_collection(app: AppHandle) -> Result<Option<Collection>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Postman Collection", &["json"]);

    // Set starting directory to last used location
    if let Some(last_dir) = get_last_import_directory(&app) {
        dialog = dialog.set_directory(last_dir);
    }

    dialog.pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(None);
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;

    // Save the directory for next time
    save_last_import_directory(&app, file_path);

    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let postman: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Postman collection: {}", e))?;

    // Convert Postman format to Collection
    let collection = parse_postman_collection(postman)?;

    // Save to store
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let mut collections: Vec<Collection> = store
        .get("collections")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    collections.push(collection.clone());
    store.set(
        "collections".to_string(),
        serde_json::to_value(&collections).unwrap(),
    );

    // Save baseUrl as a collection variable if present
    if let Some(base_url) = &collection.base_url {
        let mut collection_variables: HashMap<String, HashMap<String, String>> = store
            .get("collectionVariables")
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        let vars = collection_variables
            .entry(collection.id.clone())
            .or_default();
        vars.insert("baseUrl".to_string(), base_url.clone());

        store.set(
            "collectionVariables".to_string(),
            serde_json::to_value(&collection_variables).unwrap(),
        );
    }

    store.save().map_err(|e| e.to_string())?;

    Ok(Some(collection))
}

fn parse_postman_collection(postman: Value) -> Result<Collection, String> {
    let info = postman
        .get("info")
        .ok_or("Missing 'info' in Postman collection")?;

    let name = info
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Collection")
        .to_string();

    let description = info
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut endpoints = Vec::new();
    let mut folders = Vec::new();

    // Parse top-level items only as folders, flatten all nested content
    if let Some(items) = postman.get("item").and_then(|i| i.as_array()) {
        for item in items {
            // Check if this is a folder (has nested items)
            if let Some(nested_items) = item.get("item").and_then(|i| i.as_array()) {
                let folder_name = item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("Folder")
                    .to_string();

                // Collect all endpoints from this folder and its subfolders (flattened)
                let mut folder_endpoints = Vec::new();
                collect_postman_endpoints_recursive(nested_items, &mut folder_endpoints);

                if !folder_endpoints.is_empty() {
                    endpoints.extend(folder_endpoints.clone());
                    folders.push(Folder {
                        id: format!(
                            "folder_{}",
                            folder_name.replace(|c: char| !c.is_alphanumeric(), "_")
                        ),
                        name: folder_name,
                        endpoints: folder_endpoints,
                    });
                }
            } else if let Some(request) = item.get("request") {
                // Top-level request (not in a folder)
                if let Some(endpoint) = parse_postman_request(item, request) {
                    endpoints.push(endpoint);
                }
            }
        }
    }

    folders.sort_by(|a, b| a.name.cmp(&b.name));

    // Extract base URL from collection variables or first request
    let base_url = extract_postman_base_url(&postman, &endpoints);

    Ok(Collection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        base_url,
        endpoints,
        folders,
        variables: None,
    })
}

/// Extract base URL from Postman collection
/// Checks collection variables first, then derives from first request URL
fn extract_postman_base_url(postman: &Value, endpoints: &[Endpoint]) -> Option<String> {
    // First, check collection-level variables for baseUrl
    if let Some(variables) = postman.get("variable").and_then(|v| v.as_array()) {
        for var in variables {
            let key = var.get("key").and_then(|k| k.as_str()).unwrap_or_default();
            if key.eq_ignore_ascii_case("baseurl") || key.eq_ignore_ascii_case("base_url") {
                if let Some(value) = var.get("value").and_then(|v| v.as_str()) {
                    if !value.is_empty() {
                        return Some(value.to_string());
                    }
                }
            }
        }
    }

    // If no variable found, try to extract from first endpoint's URL
    if let Some(first_endpoint) = endpoints.first() {
        let path = &first_endpoint.path;
        // Check if path contains a full URL (http:// or https://)
        if path.starts_with("http://") || path.starts_with("https://") {
            // Extract base URL (scheme + host)
            if let Ok(url) = url::Url::parse(path) {
                let base = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
                if let Some(port) = url.port() {
                    return Some(format!("{}:{}", base, port));
                }
                return Some(base);
            }
        }
    }

    None
}

/// Recursively collect all endpoints from nested Postman items (flattens the structure)
fn collect_postman_endpoints_recursive(items: &[Value], endpoints: &mut Vec<Endpoint>) {
    for item in items {
        // If this is a folder, recurse into it
        if let Some(nested_items) = item.get("item").and_then(|i| i.as_array()) {
            collect_postman_endpoints_recursive(nested_items, endpoints);
            continue;
        }

        // This is a request
        if let Some(request) = item.get("request") {
            if let Some(endpoint) = parse_postman_request(item, request) {
                endpoints.push(endpoint);
            }
        }
    }
}

/// Parse a single Postman request into an Endpoint
fn parse_postman_request(item: &Value, request: &Value) -> Option<Endpoint> {
    let name = item
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Unnamed Request")
        .to_string();

    let method = request
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("GET")
        .to_uppercase();

    let url = request.get("url");
    let path = extract_postman_url(url);
    let parameters = extract_postman_parameters(url, request);
    let request_body = extract_postman_body(request.get("body"));
    let security = extract_postman_auth(request.get("auth"));

    Some(Endpoint {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        method,
        path,
        description: request
            .get("description")
            .and_then(|d| d.as_str())
            .map(|s| s.to_string()),
        parameters,
        request_body,
        responses: None,
        security,
    })
}

/// Extract authentication configuration from Postman auth format
/// Converts Postman's auth object to { type, config } format expected by frontend
fn extract_postman_auth(auth: Option<&Value>) -> Option<Value> {
    let auth_obj = auth?.as_object()?;

    let auth_type = auth_obj.get("type").and_then(|t| t.as_str())?;

    match auth_type {
        "bearer" => {
            // Postman format: { type: "bearer", bearer: [{ key: "token", value: "xxx" }] }
            let token = auth_obj
                .get("bearer")
                .and_then(|b| b.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("token"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            Some(serde_json::json!({
                "type": "bearer",
                "config": {
                    "token": token
                }
            }))
        }
        "basic" => {
            // Postman format: { type: "basic", basic: [{ key: "username", value: "xxx" }, { key: "password", value: "xxx" }] }
            let basic_arr = auth_obj.get("basic").and_then(|b| b.as_array());

            let username = basic_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("username"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let password = basic_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("password"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            Some(serde_json::json!({
                "type": "basic",
                "config": {
                    "username": username,
                    "password": password
                }
            }))
        }
        "apikey" => {
            // Postman format: { type: "apikey", apikey: [{ key: "key", value: "xxx" }, { key: "value", value: "xxx" }, { key: "in", value: "header" }] }
            let apikey_arr = auth_obj.get("apikey").and_then(|a| a.as_array());

            let key_name = apikey_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("key"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let key_value = apikey_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("value"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let location = apikey_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("in"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("header");

            Some(serde_json::json!({
                "type": "api-key",
                "config": {
                    "keyName": key_name,
                    "keyValue": key_value,
                    "location": location
                }
            }))
        }
        "digest" => {
            // Postman format: { type: "digest", digest: [{ key: "username", value: "xxx" }, { key: "password", value: "xxx" }] }
            let digest_arr = auth_obj.get("digest").and_then(|d| d.as_array());

            let username = digest_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("username"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let password = digest_arr
                .and_then(|arr| {
                    arr.iter()
                        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some("password"))
                })
                .and_then(|item| item.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            Some(serde_json::json!({
                "type": "digest",
                "config": {
                    "username": username,
                    "password": password
                }
            }))
        }
        "noauth" | "none" => None,
        _ => None,
    }
}

/// Extract request body from Postman body format
/// Converts Postman's { mode: "raw", raw: "..." } to { example: "..." }
fn extract_postman_body(body: Option<&Value>) -> Option<Value> {
    let body_obj = body?.as_object()?;

    let mode = body_obj.get("mode").and_then(|m| m.as_str()).unwrap_or("");

    match mode {
        "raw" => {
            // Raw body - extract the raw content as example
            let raw_content = body_obj.get("raw").and_then(|r| r.as_str()).unwrap_or("");
            if raw_content.is_empty() {
                return None;
            }

            // Return in format expected by frontend: { example: "..." }
            Some(serde_json::json!({
                "example": raw_content
            }))
        }
        "formdata" => {
            // Form data - convert to example object
            if let Some(formdata) = body_obj.get("formdata").and_then(|f| f.as_array()) {
                let mut form_obj = serde_json::Map::new();
                for item in formdata {
                    if let (Some(key), Some(value)) = (
                        item.get("key").and_then(|k| k.as_str()),
                        item.get("value").and_then(|v| v.as_str()),
                    ) {
                        form_obj.insert(key.to_string(), Value::String(value.to_string()));
                    }
                }
                if !form_obj.is_empty() {
                    return Some(serde_json::json!({
                        "example": serde_json::to_string_pretty(&Value::Object(form_obj)).unwrap_or_default()
                    }));
                }
            }
            None
        }
        "urlencoded" => {
            // URL encoded - convert to example object
            if let Some(urlencoded) = body_obj.get("urlencoded").and_then(|u| u.as_array()) {
                let mut form_obj = serde_json::Map::new();
                for item in urlencoded {
                    if let (Some(key), Some(value)) = (
                        item.get("key").and_then(|k| k.as_str()),
                        item.get("value").and_then(|v| v.as_str()),
                    ) {
                        form_obj.insert(key.to_string(), Value::String(value.to_string()));
                    }
                }
                if !form_obj.is_empty() {
                    return Some(serde_json::json!({
                        "example": serde_json::to_string_pretty(&Value::Object(form_obj)).unwrap_or_default()
                    }));
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_postman_url(url: Option<&Value>) -> String {
    let raw_url = match url {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(obj)) => {
            // Prefer "raw" field if available
            if let Some(raw) = obj.get("raw").and_then(|r| r.as_str()) {
                raw.to_string()
            } else {
                // Fallback: construct URL from host and path arrays
                let host = obj
                    .get("host")
                    .and_then(|h| h.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join(".")
                    })
                    .unwrap_or_default();

                let path = obj
                    .get("path")
                    .and_then(|p| p.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join("/")
                    })
                    .unwrap_or_default();

                if host.is_empty() && path.is_empty() {
                    "/".to_string()
                } else if host.is_empty() {
                    format!("/{}", path)
                } else if path.is_empty() {
                    host
                } else {
                    format!("{}/{}", host, path)
                }
            }
        }
        _ => "/".to_string(),
    };

    // Convert Postman :param format to {{param}} format
    // e.g., /posts/:id -> /posts/{{id}}
    let re = regex::Regex::new(r":([a-zA-Z_][a-zA-Z0-9_]*)").unwrap();
    re.replace_all(&raw_url, "{{$1}}").to_string()
}

/// Extract parameters from Postman URL object and request headers
fn extract_postman_parameters(url: Option<&Value>, request: &Value) -> Option<Value> {
    let mut path_params: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut query_params: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut header_params: serde_json::Map<String, Value> = serde_json::Map::new();

    // Extract from URL object if present
    if let Some(url_obj) = url.and_then(|u| u.as_object()) {
        // Extract path variables (e.g., :id becomes a path parameter)
        if let Some(variables) = url_obj.get("variable").and_then(|v| v.as_array()) {
            for var in variables {
                let key = var.get("key").and_then(|k| k.as_str()).unwrap_or_default();
                if key.is_empty() {
                    continue;
                }

                let mut param_obj = serde_json::Map::new();
                let value = var
                    .get("value")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                param_obj.insert("example".to_string(), Value::String(value.to_string()));

                if let Some(desc) = var.get("description").and_then(|d| d.as_str()) {
                    param_obj.insert("description".to_string(), Value::String(desc.to_string()));
                }

                path_params.insert(key.to_string(), Value::Object(param_obj));
            }
        }

        // Extract query parameters
        if let Some(query) = url_obj.get("query").and_then(|q| q.as_array()) {
            for q_param in query {
                let key = q_param
                    .get("key")
                    .and_then(|k| k.as_str())
                    .unwrap_or_default();
                if key.is_empty() {
                    continue;
                }

                let mut param_obj = serde_json::Map::new();
                let value = q_param
                    .get("value")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                param_obj.insert("example".to_string(), Value::String(value.to_string()));

                if let Some(desc) = q_param.get("description").and_then(|d| d.as_str()) {
                    param_obj.insert("description".to_string(), Value::String(desc.to_string()));
                }

                query_params.insert(key.to_string(), Value::Object(param_obj));
            }
        }
    }

    // Extract headers from request.header array
    if let Some(headers) = request.get("header").and_then(|h| h.as_array()) {
        for header in headers {
            let key = header
                .get("key")
                .and_then(|k| k.as_str())
                .unwrap_or_default();
            if key.is_empty() {
                continue;
            }

            let mut param_obj = serde_json::Map::new();
            let value = header
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            param_obj.insert("example".to_string(), Value::String(value.to_string()));

            if let Some(desc) = header.get("description").and_then(|d| d.as_str()) {
                param_obj.insert("description".to_string(), Value::String(desc.to_string()));
            }

            // Check if header is disabled
            if let Some(disabled) = header.get("disabled").and_then(|d| d.as_bool()) {
                if disabled {
                    continue; // Skip disabled headers
                }
            }

            header_params.insert(key.to_string(), Value::Object(param_obj));
        }
    }

    // Only return if we have any parameters
    if path_params.is_empty() && query_params.is_empty() && header_params.is_empty() {
        return None;
    }

    let mut result = serde_json::Map::new();
    if !path_params.is_empty() {
        result.insert("path".to_string(), Value::Object(path_params));
    }
    if !query_params.is_empty() {
        result.insert("query".to_string(), Value::Object(query_params));
    }
    if !header_params.is_empty() {
        result.insert("header".to_string(), Value::Object(header_params));
    }

    Some(Value::Object(result))
}

#[tauri::command]
pub async fn import_postman_environment(app: AppHandle) -> Result<Option<Value>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Postman Environment", &["json"]);

    // Set starting directory to last used location
    if let Some(last_dir) = get_last_import_directory(&app) {
        dialog = dialog.set_directory(last_dir);
    }

    dialog.pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(None);
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;

    // Save the directory for next time
    save_last_import_directory(&app, file_path);

    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let env: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Postman environment: {}", e))?;

    // Extract variables
    let mut variables = HashMap::new();

    if let Some(values) = env.get("values").and_then(|v| v.as_array()) {
        for value in values {
            if let (Some(key), Some(val)) = (
                value.get("key").and_then(|k| k.as_str()),
                value.get("value").and_then(|v| v.as_str()),
            ) {
                variables.insert(key.to_string(), val.to_string());
            }
        }
    }

    Ok(Some(serde_json::to_value(variables).unwrap()))
}

#[tauri::command]
pub async fn export_openapi(
    app: AppHandle,
    collection_id: String,
    format: String,
) -> Result<Value, String> {
    // Get collection from store
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let collections: Vec<Collection> = store
        .get("collections")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let collection = collections
        .iter()
        .find(|c| c.id == collection_id)
        .ok_or("Collection not found")?;

    // Show save dialog
    let file_ext = if format == "yaml" { "yaml" } else { "json" };
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(format!("{}.openapi.{}", collection.name, file_ext))
        .add_filter(
            if format == "yaml" {
                "YAML Files"
            } else {
                "JSON Files"
            },
            &[file_ext],
        );

    // Set starting directory to last used location
    if let Some(last_dir) = get_last_import_directory(&app) {
        dialog = dialog.set_directory(last_dir);
    }

    dialog.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(serde_json::json!({ "success": false, "cancelled": true }));
    };

    // Convert to OpenAPI format
    let (openapi_spec, skipped) = collection_to_openapi(collection);

    let content = if format == "yaml" {
        serde_yaml::to_string(&openapi_spec).map_err(|e| e.to_string())?
    } else {
        serde_json::to_string_pretty(&openapi_spec).map_err(|e| e.to_string())?
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;

    // Save the directory for next time
    save_last_import_directory(&app, file_path);

    std::fs::write(file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy(),
        "format": format,
        "skipped": {
            "count": skipped.len(),
            "items": skipped
        }
    }))
}

#[tauri::command]
pub async fn export_postman(app: AppHandle, collection_id: String) -> Result<Value, String> {
    // Get collection from store
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let collections: Vec<Collection> = store
        .get("collections")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let collection = collections
        .iter()
        .find(|c| c.id == collection_id)
        .ok_or("Collection not found")?;

    // Show save dialog
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(format!("{}.postman_collection.json", collection.name))
        .add_filter("Postman Collection", &["json"]);

    // Set starting directory to last used location
    if let Some(last_dir) = get_last_import_directory(&app) {
        dialog = dialog.set_directory(last_dir);
    }

    dialog.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(serde_json::json!({ "success": false, "cancelled": true }));
    };

    let (postman_collection, skipped) = collection_to_postman(collection);
    let content = serde_json::to_string_pretty(&postman_collection).map_err(|e| e.to_string())?;

    let file_path = path.as_path().ok_or("Invalid file path")?;

    // Save the directory for next time
    save_last_import_directory(&app, file_path);

    std::fs::write(file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy(),
        "skipped": {
            "count": skipped.len(),
            "items": skipped
        }
    }))
}

fn collection_to_openapi(collection: &Collection) -> (Value, Vec<String>) {
    let mut paths: HashMap<String, HashMap<String, Value>> = HashMap::new();
    let mut skipped: Vec<String> = Vec::new();

    for endpoint in &collection.endpoints {
        if !is_http_method(&endpoint.method) {
            skipped.push(endpoint.name.clone());
            continue;
        }
        let method = endpoint.method.to_lowercase();
        let mut operation = serde_json::json!({
            "summary": endpoint.name,
            "responses": {
                "200": {
                    "description": "Successful response"
                }
            }
        });

        if let Some(desc) = &endpoint.description {
            operation["description"] = Value::String(desc.clone());
        }

        if let Some(params) = &endpoint.parameters {
            operation["parameters"] = serde_json::to_value(params).unwrap_or(Value::Array(vec![]));
        }

        if let Some(body) = &endpoint.request_body {
            operation["requestBody"] = body.clone();
        }

        if let Some(responses) = &endpoint.responses {
            operation["responses"] =
                serde_json::to_value(responses).unwrap_or(Value::Object(serde_json::Map::new()));
        }

        paths
            .entry(endpoint.path.clone())
            .or_default()
            .insert(method, operation);
    }

    let mut spec = serde_json::json!({
        "openapi": "3.0.3",
        "info": {
            "title": collection.name,
            "version": "1.0.0"
        },
        "paths": paths
    });

    if let Some(desc) = &collection.description {
        spec["info"]["description"] = Value::String(desc.clone());
    }

    if let Some(base_url) = &collection.base_url {
        spec["servers"] = serde_json::json!([{ "url": base_url }]);
    }

    (spec, skipped)
}

fn endpoint_to_postman_item(collection: &Collection, endpoint: &Endpoint) -> Value {
    let url = if collection.base_url.is_some() {
        format!("{{{{baseUrl}}}}{}", endpoint.path)
    } else {
        endpoint.path.clone()
    };

    let mut request = serde_json::json!({
        "method": endpoint.method,
        "url": url
    });

    if let Some(body) = &endpoint.request_body {
        if let Some(example) = body.get("example").and_then(|v| v.as_str()) {
            request["body"] = serde_json::json!({
                "mode": "raw",
                "raw": example
            });
        }
    }

    if let Some(security) = &endpoint.security {
        if let Some(auth_type) = security.get("type").and_then(|v| v.as_str()) {
            match auth_type {
                "bearer" => {
                    if let Some(token) = security
                        .get("config")
                        .and_then(|c| c.get("token"))
                        .and_then(|v| v.as_str())
                    {
                        request["auth"] = serde_json::json!({
                            "type": "bearer",
                            "bearer": [{ "key": "token", "value": token, "type": "string" }]
                        });
                    }
                }
                "basic" => {
                    let username = security
                        .get("config")
                        .and_then(|c| c.get("username"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let password = security
                        .get("config")
                        .and_then(|c| c.get("password"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    request["auth"] = serde_json::json!({
                        "type": "basic",
                        "basic": [
                            { "key": "username", "value": username, "type": "string" },
                            { "key": "password", "value": password, "type": "string" }
                        ]
                    });
                }
                "api-key" => {
                    let key = security
                        .get("config")
                        .and_then(|c| c.get("key"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let value = security
                        .get("config")
                        .and_then(|c| c.get("value"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let location = security
                        .get("config")
                        .and_then(|c| c.get("location"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("header");
                    request["auth"] = serde_json::json!({
                        "type": "apikey",
                        "apikey": [
                            { "key": "key", "value": key, "type": "string" },
                            { "key": "value", "value": value, "type": "string" },
                            { "key": "in", "value": location, "type": "string" }
                        ]
                    });
                }
                _ => {}
            }
        }
    }

    serde_json::json!({
        "name": endpoint.name,
        "request": request
    })
}

fn collection_to_postman(collection: &Collection) -> (Value, Vec<String>) {
    let mut skipped: Vec<String> = Vec::new();

    let mut items: Vec<Value> = Vec::new();

    // Foldered endpoints
    for folder in &collection.folders {
        let mut folder_items: Vec<Value> = Vec::new();
        for endpoint in &folder.endpoints {
            if !is_http_method(&endpoint.method) {
                skipped.push(format!("{}/{}", folder.name, endpoint.name));
                continue;
            }
            folder_items.push(endpoint_to_postman_item(collection, endpoint));
        }

        if !folder_items.is_empty() {
            items.push(serde_json::json!({
                "name": folder.name,
                "item": folder_items
            }));
        }
    }

    // Top-level endpoints
    for endpoint in &collection.endpoints {
        if !is_http_method(&endpoint.method) {
            skipped.push(endpoint.name.clone());
            continue;
        }
        items.push(endpoint_to_postman_item(collection, endpoint));
    }

    let mut variables: Vec<Value> = Vec::new();
    if collection.base_url.is_some() {
        variables.push(serde_json::json!({
            "key": "baseUrl",
            "value": collection.base_url.clone().unwrap_or_default(),
            "type": "string"
        }));
    }

    (
        serde_json::json!({
            "info": {
                "name": collection.name,
                "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
            },
            "item": items,
            "variable": variables
        }),
        skipped,
    )
}
