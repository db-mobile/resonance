//! Postman collection parsing: converts a Postman export `Value` into a `Collection`.

use super::{Collection, Endpoint, Folder};
use serde_json::Value;

pub(crate) fn parse_postman_collection(postman: Value) -> Result<Collection, String> {
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
/// Converts Postman's body to a format understood by the frontend.
/// Raw bodies become { example: "..." }.
/// Form bodies become { type: "formdata"|"urlencoded", fields: { key: value } }.
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
            if let Some(formdata) = body_obj.get("formdata").and_then(|f| f.as_array()) {
                let mut fields = serde_json::Map::new();
                for item in formdata {
                    // Skip file-type fields (file upload is not yet supported)
                    if item.get("type").and_then(|t| t.as_str()) == Some("file") {
                        continue;
                    }
                    if let (Some(key), Some(value)) = (
                        item.get("key").and_then(|k| k.as_str()),
                        item.get("value").and_then(|v| v.as_str()),
                    ) {
                        fields.insert(key.to_string(), Value::String(value.to_string()));
                    }
                }
                if !fields.is_empty() {
                    return Some(serde_json::json!({
                        "type": "formdata",
                        "fields": Value::Object(fields)
                    }));
                }
            }
            None
        }
        "urlencoded" => {
            if let Some(urlencoded) = body_obj.get("urlencoded").and_then(|u| u.as_array()) {
                let mut fields = serde_json::Map::new();
                for item in urlencoded {
                    if let (Some(key), Some(value)) = (
                        item.get("key").and_then(|k| k.as_str()),
                        item.get("value").and_then(|v| v.as_str()),
                    ) {
                        fields.insert(key.to_string(), Value::String(value.to_string()));
                    }
                }
                if !fields.is_empty() {
                    return Some(serde_json::json!({
                        "type": "urlencoded",
                        "fields": Value::Object(fields)
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
