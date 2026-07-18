//! Postman collection parsing: converts a Postman export `Value` into a `Collection`.

use super::{Collection, Endpoint, Folder, VariableEntry};
use crate::commands::scripts::ScriptData;
use serde_json::Value;
use std::collections::HashSet;

/// Script blocks inherited from the Postman collection and ancestor folders,
/// already prefixed with provenance banners. Postman executes collection,
/// folder, then request scripts; prepending inherited blocks reproduces that
/// order in the app's per-request script model.
#[derive(Default, Clone)]
struct InheritedScripts {
    pre: Vec<String>,
    test: Vec<String>,
}

impl InheritedScripts {
    fn push_labeled(&mut self, owner: &Value, scope: &str) {
        let (pre, test) = extract_postman_events(owner);
        if !pre.is_empty() {
            self.pre.push(format!(
                "// [Imported: Postman {} pre-request script]\n{}",
                scope, pre
            ));
        }
        if !test.is_empty() {
            self.test.push(format!(
                "// [Imported: Postman {} test script]\n{}",
                scope, test
            ));
        }
    }
}

/// Result of parsing a Postman request body: either a regular request body
/// value, a GraphQL payload destined for the endpoint's `graphql_data`, or nothing.
enum ParsedBody {
    Empty,
    RequestBody(Value),
    GraphQL(Value),
}

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

    let mut inherited = InheritedScripts::default();
    inherited.push_labeled(&postman, "collection-level");

    let mut endpoints = Vec::new();
    let mut folders = Vec::new();
    let mut used_folder_ids = HashSet::new();

    if let Some(items) = postman.get("item").and_then(|i| i.as_array()) {
        collect_items(
            items,
            &[],
            &inherited,
            None,
            &mut endpoints,
            &mut folders,
            &mut used_folder_ids,
        );
    }

    folders.sort_by(|a, b| a.name.cmp(&b.name));

    let base_url = extract_postman_base_url(&postman, &endpoints);
    let variables = extract_postman_variables(&postman, base_url.as_deref());

    Ok(Collection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        base_url,
        endpoints,
        folders,
        variables,
        auth_config: extract_postman_auth(postman.get("auth")),
    })
}

/// Walk Postman items recursively. Nested folders are preserved as single-level
/// folders with composite names ("Parent / Child"); every endpoint is pushed to
/// both its folder and the flat `endpoints` list (the storage model expects
/// that duplication).
fn collect_items(
    items: &[Value],
    name_chain: &[String],
    inherited: &InheritedScripts,
    folder_auth: Option<&Value>,
    endpoints: &mut Vec<Endpoint>,
    folders: &mut Vec<Folder>,
    used_folder_ids: &mut HashSet<String>,
) {
    for item in items {
        if let Some(nested_items) = item.get("item").and_then(|i| i.as_array()) {
            let folder_name = item
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("Folder")
                .to_string();

            let mut chain = name_chain.to_vec();
            chain.push(folder_name.clone());

            let mut child_inherited = inherited.clone();
            child_inherited.push_labeled(item, &format!("folder-level ({})", folder_name));

            // Nearest folder auth wins; nested folders without their own auth
            // materialize the ancestor's (the flattened folder model cannot
            // walk parent folders at request time).
            let own_auth = extract_postman_auth(item.get("auth"));
            let child_auth = own_auth.as_ref().or(folder_auth);

            collect_items(
                nested_items,
                &chain,
                &child_inherited,
                child_auth,
                endpoints,
                folders,
                used_folder_ids,
            );
        } else if let Some(request) = item.get("request") {
            if let Some(endpoint) = parse_postman_request(item, request, inherited) {
                if name_chain.is_empty() {
                    endpoints.push(endpoint);
                } else {
                    let composite_name = name_chain.join(" / ");
                    endpoints.push(endpoint.clone());
                    if let Some(folder) = folders.iter_mut().find(|f| f.name == composite_name) {
                        folder.endpoints.push(endpoint);
                    } else {
                        folders.push(Folder {
                            id: unique_folder_id(&composite_name, used_folder_ids),
                            name: composite_name,
                            endpoints: vec![endpoint],
                            auth_config: folder_auth.cloned(),
                        });
                    }
                }
            }
        }
    }
}

/// Folder ids follow the frontend convention (`folder_<sanitized name>`,
/// see CollectionService.js). Distinct composite names can sanitize to the
/// same id ("A - B" vs "A / B"), so collisions get a numeric suffix.
fn unique_folder_id(name: &str, used: &mut HashSet<String>) -> String {
    let base = format!(
        "folder_{}",
        name.replace(|c: char| !c.is_alphanumeric(), "_")
    );
    let mut candidate = base.clone();
    let mut counter = 2;
    while !used.insert(candidate.clone()) {
        candidate = format!("{}_{}", base, counter);
        counter += 1;
    }
    candidate
}

/// Extract base URL from Postman collection
/// Checks collection variables first, then derives from first request URL
fn extract_postman_base_url(postman: &Value, endpoints: &[Endpoint]) -> Option<String> {
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

    if let Some(first_endpoint) = endpoints.first() {
        let path = &first_endpoint.path;
        if path.starts_with("http://") || path.starts_with("https://") {
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

/// Import the full Postman `variable[]` list, skipping disabled and empty-key
/// entries (the app has no disabled flag; importing them active would change
/// resolution behavior). Appends a `baseUrl` entry when one was derived and
/// the list does not already define it.
fn extract_postman_variables(
    postman: &Value,
    base_url: Option<&str>,
) -> Option<Vec<VariableEntry>> {
    let mut entries: Vec<VariableEntry> = Vec::new();

    if let Some(variables) = postman.get("variable").and_then(|v| v.as_array()) {
        for var in variables {
            if var.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
                continue;
            }
            let Some(key) = var
                .get("key")
                .and_then(|k| k.as_str())
                .filter(|k| !k.is_empty())
            else {
                continue;
            };
            let value = match var.get("value") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => serde_json::to_string(other).unwrap_or_default(),
            };
            entries.push(VariableEntry {
                key: key.to_string(),
                value,
            });
        }
    }

    if let Some(base_url) = base_url.filter(|s| !s.is_empty()) {
        let has_base_url = entries.iter().any(|e| {
            e.key.eq_ignore_ascii_case("baseurl") || e.key.eq_ignore_ascii_case("base_url")
        });
        if !has_base_url {
            entries.push(VariableEntry {
                key: "baseUrl".to_string(),
                value: base_url.to_string(),
            });
        }
    }

    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

/// Join a Postman event's `script.exec` (string array or plain string) into a
/// single script body. Returns None for missing or blank scripts.
fn extract_event_script(event: &Value) -> Option<String> {
    let exec = event.get("script")?.get("exec")?;
    let content = match exec {
        Value::String(s) => s.clone(),
        Value::Array(lines) => lines
            .iter()
            .filter_map(|l| l.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    if content.trim().is_empty() {
        None
    } else {
        Some(content)
    }
}

/// Extract (pre-request, test) scripts from an item's `event[]` array.
/// Disabled events are skipped; multiple events with the same `listen` are
/// concatenated with a blank line.
fn extract_postman_events(owner: &Value) -> (String, String) {
    let mut pre: Vec<String> = Vec::new();
    let mut test: Vec<String> = Vec::new();

    if let Some(events) = owner.get("event").and_then(|e| e.as_array()) {
        for event in events {
            if event.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
                continue;
            }
            let Some(script) = extract_event_script(event) else {
                continue;
            };
            match event.get("listen").and_then(|l| l.as_str()) {
                Some("prerequest") => pre.push(script),
                Some("test") => test.push(script),
                _ => {}
            }
        }
    }

    (pre.join("\n\n"), test.join("\n\n"))
}

/// Combine inherited (collection/folder) script blocks with the request's own
/// events into the `ScriptData` shape, or None when everything is empty.
fn build_request_scripts(item: &Value, inherited: &InheritedScripts) -> Option<Value> {
    let (own_pre, own_test) = extract_postman_events(item);

    let mut pre_blocks = inherited.pre.clone();
    if !own_pre.is_empty() {
        pre_blocks.push(own_pre);
    }
    let mut test_blocks = inherited.test.clone();
    if !own_test.is_empty() {
        test_blocks.push(own_test);
    }

    let pre_request_script = pre_blocks.join("\n\n");
    let test_script = test_blocks.join("\n\n");

    if pre_request_script.is_empty() && test_script.is_empty() {
        return None;
    }

    serde_json::to_value(ScriptData {
        pre_request_script,
        test_script,
    })
    .ok()
}

/// Parse a single Postman request into an Endpoint
fn parse_postman_request(
    item: &Value,
    request: &Value,
    inherited: &InheritedScripts,
) -> Option<Endpoint> {
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
    let (request_body, graphql_data) = match extract_postman_body(request.get("body")) {
        ParsedBody::RequestBody(body) => (Some(body), None),
        ParsedBody::GraphQL(graphql) => (None, Some(graphql)),
        ParsedBody::Empty => (None, None),
    };
    let security = extract_postman_auth(request.get("auth"));
    let scripts = build_request_scripts(item, inherited);

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
        scripts,
        graphql_data,
    })
}

/// Find the value of a `{ key, value }` entry in a Postman auth parameter array.
fn auth_param<'a>(params: Option<&'a Vec<Value>>, key: &str) -> Option<&'a str> {
    params?
        .iter()
        .find(|item| item.get("key").and_then(|k| k.as_str()) == Some(key))
        .and_then(|item| item.get("value"))
        .and_then(|v| v.as_str())
}

/// Extract authentication configuration from Postman auth format
/// Converts Postman's auth object to { type, config } format expected by frontend
fn extract_postman_auth(auth: Option<&Value>) -> Option<Value> {
    let auth_obj = auth?.as_object()?;

    let auth_type = auth_obj.get("type").and_then(|t| t.as_str())?;

    match auth_type {
        "bearer" => {
            let params = auth_obj.get("bearer").and_then(|b| b.as_array());
            Some(serde_json::json!({
                "type": "bearer",
                "config": {
                    "token": auth_param(params, "token").unwrap_or_default()
                }
            }))
        }
        "basic" => {
            let params = auth_obj.get("basic").and_then(|b| b.as_array());
            Some(serde_json::json!({
                "type": "basic",
                "config": {
                    "username": auth_param(params, "username").unwrap_or_default(),
                    "password": auth_param(params, "password").unwrap_or_default()
                }
            }))
        }
        "apikey" => {
            let params = auth_obj.get("apikey").and_then(|a| a.as_array());
            Some(serde_json::json!({
                "type": "api-key",
                "config": {
                    "keyName": auth_param(params, "key").unwrap_or_default(),
                    "keyValue": auth_param(params, "value").unwrap_or_default(),
                    "location": auth_param(params, "in").unwrap_or("header")
                }
            }))
        }
        "digest" => {
            let params = auth_obj.get("digest").and_then(|d| d.as_array());
            Some(serde_json::json!({
                "type": "digest",
                "config": {
                    "username": auth_param(params, "username").unwrap_or_default(),
                    "password": auth_param(params, "password").unwrap_or_default()
                }
            }))
        }
        "oauth2" => Some(extract_postman_oauth2(
            auth_obj.get("oauth2").and_then(|o| o.as_array()),
        )),
        "noauth" | "none" => Some(serde_json::json!({ "type": "none", "config": {} })),
        _ => None,
    }
}

/// Map Postman oauth2 parameters to the app's oauth2 config shape
/// (see authManager.js / oauth.rs). Absent keys are omitted so the frontend
/// applies its own defaults. Unknown grant types fall back to "manual" when a
/// token is present, otherwise to Postman's default "authorization_code".
fn extract_postman_oauth2(params: Option<&Vec<Value>>) -> Value {
    let mut config = serde_json::Map::new();

    let access_token = auth_param(params, "accessToken");
    let (grant_type, use_pkce) = match auth_param(params, "grant_type") {
        Some("authorization_code") => ("authorization_code", Some(false)),
        Some("authorization_code_with_pkce") => ("authorization_code", Some(true)),
        Some("client_credentials") => ("client_credentials", None),
        Some("password_credentials") => ("password", None),
        _ if access_token.is_some() => ("manual", None),
        _ => ("authorization_code", None),
    };
    config.insert(
        "grantType".to_string(),
        Value::String(grant_type.to_string()),
    );
    if let Some(use_pkce) = use_pkce {
        config.insert("usePkce".to_string(), Value::Bool(use_pkce));
    }

    let mappings = [
        ("accessTokenUrl", "tokenUrl"),
        ("authUrl", "authorizationUrl"),
        ("clientId", "clientId"),
        ("clientSecret", "clientSecret"),
        ("scope", "scope"),
        ("redirect_uri", "redirectUri"),
        ("username", "username"),
        ("password", "password"),
        ("audience", "audience"),
        ("client_authentication", "clientAuthMethod"),
        ("headerPrefix", "headerPrefix"),
        ("accessToken", "token"),
    ];
    for (postman_key, app_key) in mappings {
        if let Some(value) = auth_param(params, postman_key).filter(|v| !v.is_empty()) {
            config.insert(app_key.to_string(), Value::String(value.to_string()));
        }
    }

    serde_json::json!({
        "type": "oauth2",
        "config": Value::Object(config)
    })
}

/// Extract request body from Postman body format
/// Raw bodies become { example: "..." }.
/// Form bodies become { type: "formdata"|"urlencoded", fields: { key: value } }.
/// GraphQL bodies become a `graphql_data` payload { mode, query, variables }.
fn extract_postman_body(body: Option<&Value>) -> ParsedBody {
    let Some(body_obj) = body.and_then(|b| b.as_object()) else {
        return ParsedBody::Empty;
    };

    let mode = body_obj.get("mode").and_then(|m| m.as_str()).unwrap_or("");

    match mode {
        "raw" => {
            let raw_content = body_obj.get("raw").and_then(|r| r.as_str()).unwrap_or("");
            if raw_content.is_empty() {
                return ParsedBody::Empty;
            }

            ParsedBody::RequestBody(serde_json::json!({
                "example": raw_content
            }))
        }
        "formdata" => {
            if let Some(formdata) = body_obj.get("formdata").and_then(|f| f.as_array()) {
                let mut fields = serde_json::Map::new();
                for item in formdata {
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
                    return ParsedBody::RequestBody(serde_json::json!({
                        "type": "formdata",
                        "fields": Value::Object(fields)
                    }));
                }
            }
            ParsedBody::Empty
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
                    return ParsedBody::RequestBody(serde_json::json!({
                        "type": "urlencoded",
                        "fields": Value::Object(fields)
                    }));
                }
            }
            ParsedBody::Empty
        }
        "graphql" => {
            let graphql = body_obj.get("graphql").and_then(|g| g.as_object());
            let query = graphql
                .and_then(|g| g.get("query"))
                .and_then(|q| q.as_str())
                .unwrap_or("")
                .to_string();
            let variables = match graphql.and_then(|g| g.get("variables")) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Null) | None => String::new(),
                Some(other) => serde_json::to_string(other).unwrap_or_default(),
            };
            if query.is_empty() && variables.is_empty() {
                return ParsedBody::Empty;
            }
            ParsedBody::GraphQL(serde_json::json!({
                "mode": "graphql",
                "query": query,
                "variables": variables
            }))
        }
        _ => ParsedBody::Empty,
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

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
        "info": {
            "name": "Fixture",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        "event": [
            { "listen": "prerequest", "script": { "exec": ["console.log('col pre');"] } },
            { "listen": "test", "script": { "exec": "console.log('col test');" } }
        ],
        "variable": [
            { "key": "baseUrl", "value": "https://api.example.com" },
            { "key": "apiKey", "value": "secret" },
            { "key": "off", "value": "x", "disabled": true },
            { "key": "retries", "value": 3 },
            { "key": "", "value": "ignored" }
        ],
        "item": [
            {
                "name": "Ping",
                "request": { "method": "GET", "url": "https://api.example.com/ping" }
            },
            {
                "name": "Users",
                "event": [
                    { "listen": "prerequest", "script": { "exec": "console.log('folder pre');" } }
                ],
                "item": [
                    {
                        "name": "List Users",
                        "event": [
                            { "listen": "prerequest", "script": { "exec": ["console.log('req pre');"] } },
                            { "listen": "test", "script": { "exec": ["console.log('req test');"] } },
                            { "listen": "test", "disabled": true, "script": { "exec": ["console.log('disabled');"] } }
                        ],
                        "request": { "method": "GET", "url": "https://api.example.com/users" }
                    },
                    {
                        "name": "Admin",
                        "item": [
                            {
                                "name": "Delete User",
                                "request": { "method": "DELETE", "url": "https://api.example.com/users/1" }
                            }
                        ]
                    }
                ]
            },
            {
                "name": "A - B",
                "item": [
                    { "name": "R1", "request": { "method": "GET", "url": "https://api.example.com/r1" } }
                ]
            },
            {
                "name": "A",
                "item": [
                    {
                        "name": "B",
                        "item": [
                            { "name": "R2", "request": { "method": "GET", "url": "https://api.example.com/r2" } }
                        ]
                    }
                ]
            },
            {
                "name": "GraphQL Query",
                "request": {
                    "method": "POST",
                    "url": "https://api.example.com/graphql",
                    "body": {
                        "mode": "graphql",
                        "graphql": {
                            "query": "query { users { id } }",
                            "variables": "{\"limit\": 10}"
                        }
                    }
                }
            },
            {
                "name": "OAuth Request",
                "request": {
                    "method": "GET",
                    "url": "https://api.example.com/secure",
                    "auth": {
                        "type": "oauth2",
                        "oauth2": [
                            { "key": "grant_type", "value": "authorization_code_with_pkce" },
                            { "key": "accessTokenUrl", "value": "https://auth.example.com/token" },
                            { "key": "authUrl", "value": "https://auth.example.com/authorize" },
                            { "key": "clientId", "value": "client-1" },
                            { "key": "scope", "value": "read write" },
                            { "key": "client_authentication", "value": "header" }
                        ]
                    }
                }
            }
        ]
    }"#;

    fn parse_fixture() -> Collection {
        let postman: Value = serde_json::from_str(FIXTURE).expect("fixture parses");
        parse_postman_collection(postman).expect("collection parses")
    }

    fn find_endpoint<'a>(collection: &'a Collection, name: &str) -> &'a Endpoint {
        collection
            .endpoints
            .iter()
            .find(|e| e.name == name)
            .unwrap_or_else(|| panic!("endpoint {} not found", name))
    }

    #[test]
    fn folders_get_composite_names_and_unique_ids() {
        let collection = parse_fixture();

        let names: Vec<&str> = collection.folders.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["A - B", "A / B", "Users", "Users / Admin"]);

        let ids: HashSet<&str> = collection.folders.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids.len(), collection.folders.len());
        assert!(ids.contains("folder_A___B"));
        assert!(ids.contains("folder_A___B_2"));

        assert_eq!(collection.endpoints.len(), 7);
        let admin_folder = collection
            .folders
            .iter()
            .find(|f| f.name == "Users / Admin")
            .unwrap();
        assert_eq!(admin_folder.endpoints[0].name, "Delete User");
        assert!(collection
            .endpoints
            .iter()
            .any(|e| e.id == admin_folder.endpoints[0].id));
    }

    #[test]
    fn scripts_inherit_collection_and_folder_events_in_order() {
        let collection = parse_fixture();

        let list_users = find_endpoint(&collection, "List Users");
        let scripts: ScriptData =
            serde_json::from_value(list_users.scripts.clone().expect("scripts present")).unwrap();

        let col_pos = scripts
            .pre_request_script
            .find("console.log('col pre');")
            .expect("collection script included");
        let folder_pos = scripts
            .pre_request_script
            .find("console.log('folder pre');")
            .expect("folder script included");
        let own_pos = scripts
            .pre_request_script
            .find("console.log('req pre');")
            .expect("request script included");
        assert!(col_pos < folder_pos && folder_pos < own_pos);
        assert!(scripts
            .pre_request_script
            .contains("// [Imported: Postman collection-level pre-request script]"));
        assert!(scripts
            .pre_request_script
            .contains("// [Imported: Postman folder-level (Users) pre-request script]"));

        assert!(scripts.test_script.contains("console.log('col test');"));
        assert!(scripts.test_script.contains("console.log('req test');"));
        assert!(!scripts.test_script.contains("disabled"));

        let ping = find_endpoint(&collection, "Ping");
        let ping_scripts: ScriptData =
            serde_json::from_value(ping.scripts.clone().expect("inherited scripts present"))
                .unwrap();
        assert!(ping_scripts
            .pre_request_script
            .contains("console.log('col pre');"));
        assert!(!ping_scripts.pre_request_script.contains("folder pre"));
    }

    #[test]
    fn variables_are_imported_in_order_without_duplicates() {
        let collection = parse_fixture();

        let variables = collection.variables.expect("variables present");
        let pairs: Vec<(&str, &str)> = variables
            .iter()
            .map(|v| (v.key.as_str(), v.value.as_str()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("baseUrl", "https://api.example.com"),
                ("apiKey", "secret"),
                ("retries", "3")
            ]
        );
    }

    #[test]
    fn graphql_body_maps_to_graphql_data() {
        let collection = parse_fixture();

        let endpoint = find_endpoint(&collection, "GraphQL Query");
        assert!(endpoint.request_body.is_none());
        let graphql = endpoint
            .graphql_data
            .as_ref()
            .expect("graphql data present");
        assert_eq!(graphql["mode"], "graphql");
        assert_eq!(graphql["query"], "query { users { id } }");
        assert_eq!(graphql["variables"], "{\"limit\": 10}");
    }

    #[test]
    fn oauth2_auth_maps_to_app_config() {
        let collection = parse_fixture();

        let endpoint = find_endpoint(&collection, "OAuth Request");
        let security = endpoint.security.as_ref().expect("security present");
        assert_eq!(security["type"], "oauth2");
        let config = &security["config"];
        assert_eq!(config["grantType"], "authorization_code");
        assert_eq!(config["usePkce"], true);
        assert_eq!(config["tokenUrl"], "https://auth.example.com/token");
        assert_eq!(
            config["authorizationUrl"],
            "https://auth.example.com/authorize"
        );
        assert_eq!(config["clientId"], "client-1");
        assert_eq!(config["scope"], "read write");
        assert_eq!(config["clientAuthMethod"], "header");
        assert!(config.get("clientSecret").is_none());
    }
}
