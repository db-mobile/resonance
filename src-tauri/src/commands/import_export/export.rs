//! Serialization of a stored `Collection` into OpenAPI and Postman formats,
//! plus loading a collection from disk for export.

use super::storage::is_http_method;
use super::{Collection, Endpoint, Folder, VariableEntry};
use crate::commands::collections as storage_collections;
use crate::commands::scripts::ScriptData;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;

pub(crate) fn load_collection_for_export(
    app: &AppHandle,
    collection_id: &str,
) -> Result<Collection, String> {
    let (stored, raw_variables, endpoint_data) =
        storage_collections::load_for_export(app, collection_id)?;

    let mut endpoints: Vec<Endpoint> =
        serde_json::from_value(Value::Array(stored.endpoints.clone())).unwrap_or_default();
    let mut folders: Vec<Folder> =
        serde_json::from_value(Value::Array(stored.folders.clone())).unwrap_or_default();

    let variables: Option<Vec<VariableEntry>> = if raw_variables.is_empty() {
        None
    } else {
        Some(
            raw_variables
                .into_iter()
                .filter_map(|entry| {
                    let key = entry.get("key")?.as_str()?.to_string();
                    let value = entry
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    Some(VariableEntry { key, value })
                })
                .collect(),
        )
    };

    attach_endpoint_data(&endpoint_data, &mut endpoints, &mut folders);

    Ok(Collection {
        id: stored.id,
        name: stored.name,
        description: None,
        base_url: Some(stored.base_url).filter(|s| !s.is_empty()),
        endpoints,
        folders,
        variables,
        auth_config: stored.auth_config,
    })
}

/// Project each request's saved state onto its export shape. An endpoint
/// appears in both the flat list and its folder, so both occurrences are
/// filled from the same stored payload.
fn attach_endpoint_data(
    data: &HashMap<String, storage_collections::EndpointData>,
    endpoints: &mut [Endpoint],
    folders: &mut [Folder],
) {
    let fill = |endpoint: &mut Endpoint| {
        if let Some(stored) = data.get(&endpoint.id) {
            apply_live_state(endpoint, stored);
        }
    };

    for endpoint in endpoints.iter_mut() {
        fill(endpoint);
    }

    for folder in folders.iter_mut() {
        for endpoint in folder.endpoints.iter_mut() {
            fill(endpoint);
        }
    }
}

/// A request body as the exporters see it: the user's saved state first, the
/// imported spec's example second.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LiveBody {
    Raw(String),
    Form {
        urlencoded: bool,
        rows: Vec<FormRow>,
    },
    Binary {
        file_path: String,
        content_type: String,
    },
}

/// One form field; `file_path` marks a file part.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FormRow {
    pub key: String,
    pub value: String,
    pub file_path: Option<String>,
    pub enabled: bool,
}

/// Overlay a request's saved state on its export shape: scripts, GraphQL
/// body, auth, absolute URL, parameter rows, body and response schema. Saved
/// rows replace the spec bucket of the same location, keeping the spec's
/// schema and description for names that still match.
pub(crate) fn apply_live_state(
    endpoint: &mut Endpoint,
    stored: &storage_collections::EndpointData,
) {
    endpoint.scripts = stored.scripts.clone();
    endpoint.graphql_data = stored.graphql_data.clone();
    if let Some(auth) = stored.auth_config.as_ref().filter(|a| !a.is_null()) {
        endpoint.security = Some(auth.clone());
    }
    endpoint.url = stored.url.clone().filter(|u| !u.trim().is_empty());
    endpoint.parameters = merge_live_params(endpoint.parameters.take(), stored);
    endpoint.live_body = live_body(stored);
    endpoint.response_schema = stored.response_schema.clone().filter(|s| !s.is_null());
}

fn merge_live_params(
    spec: Option<Value>,
    stored: &storage_collections::EndpointData,
) -> Option<Value> {
    let mut groups = spec
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let buckets = [
        ("path", &stored.path_params),
        ("query", &stored.query_params),
        ("header", &stored.headers),
    ];
    for (location, rows) in buckets {
        if rows.is_empty() {
            continue;
        }
        let existing = groups
            .get(location)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut merged = Map::new();
        for row in rows {
            let Some(key) = row
                .get("key")
                .and_then(Value::as_str)
                .filter(|k| !k.is_empty())
            else {
                continue;
            };
            let mut entry = existing
                .get(key)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            entry.insert(
                "example".to_string(),
                Value::String(value_text(row.get("value"))),
            );
            if row.get("enabled").and_then(Value::as_bool) == Some(false) {
                entry.insert("disabled".to_string(), Value::Bool(true));
            } else {
                entry.remove("disabled");
            }
            merged.insert(key.to_string(), Value::Object(entry));
        }
        groups.insert(location.to_string(), Value::Object(merged));
    }
    let empty = groups
        .values()
        .all(|group| group.as_object().is_none_or(Map::is_empty));
    if empty {
        None
    } else {
        Some(Value::Object(groups))
    }
}

/// Scalar row values as text; hand-written YAML may carry numbers or booleans.
fn value_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn live_body(stored: &storage_collections::EndpointData) -> Option<LiveBody> {
    if let Some(form) = stored.form_body_data.as_ref().and_then(Value::as_object) {
        match form.get("mode").and_then(Value::as_str) {
            Some("text") => {
                return form
                    .get("content")
                    .and_then(Value::as_str)
                    .filter(|c| !c.trim().is_empty())
                    .map(|c| LiveBody::Raw(c.to_string()));
            }
            Some(mode @ ("formdata" | "urlencoded")) => {
                let rows = form_rows(form.get("fields"));
                return (!rows.is_empty()).then_some(LiveBody::Form {
                    urlencoded: mode == "urlencoded",
                    rows,
                });
            }
            Some("binary") => {
                let file_path = value_text(form.get("filePath"));
                if file_path.is_empty() {
                    return None;
                }
                return Some(LiveBody::Binary {
                    file_path,
                    content_type: value_text(form.get("contentType")),
                });
            }
            _ => {}
        }
    }
    stored
        .modified_body
        .as_ref()
        .filter(|b| !b.trim().is_empty())
        .map(|b| LiveBody::Raw(b.clone()))
}

/// Form fields from either the saved row list (`[{key, value, type,
/// filePath, enabled}]`) or an importer's `{key: value}` map.
fn form_rows(fields: Option<&Value>) -> Vec<FormRow> {
    match fields {
        Some(Value::Array(rows)) => rows
            .iter()
            .filter_map(|row| {
                let key = row.get("key").and_then(Value::as_str)?.to_string();
                if key.is_empty() {
                    return None;
                }
                let is_file = row.get("type").and_then(Value::as_str) == Some("file");
                Some(FormRow {
                    key,
                    value: value_text(row.get("value")),
                    file_path: is_file.then(|| value_text(row.get("filePath"))),
                    enabled: row.get("enabled").and_then(Value::as_bool) != Some(false),
                })
            })
            .collect(),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(key, value)| FormRow {
                key: key.clone(),
                value: value_text(Some(value)),
                file_path: None,
                enabled: true,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// The body an exporter should write: saved state wins over the spec example.
fn effective_body(endpoint: &Endpoint) -> Option<LiveBody> {
    if let Some(live) = &endpoint.live_body {
        return Some(live.clone());
    }
    let body = endpoint.request_body.as_ref()?;
    if let Some(kind @ ("formdata" | "urlencoded")) = body.get("type").and_then(Value::as_str) {
        let rows = form_rows(body.get("fields"));
        return (!rows.is_empty()).then_some(LiveBody::Form {
            urlencoded: kind == "urlencoded",
            rows,
        });
    }
    body.get("example")
        .and_then(Value::as_str)
        .filter(|e| !e.trim().is_empty())
        .map(|e| LiveBody::Raw(e.to_string()))
}

/// One parameter of a request, flattened from the grouped parameter maps.
struct ParamRow {
    name: String,
    value: String,
    disabled: bool,
    description: Option<String>,
}

fn param_rows(endpoint: &Endpoint, location: &str) -> Vec<ParamRow> {
    endpoint
        .parameters
        .as_ref()
        .and_then(|p| p.get(location))
        .and_then(Value::as_object)
        .map(|group| {
            group
                .iter()
                .map(|(name, param)| ParamRow {
                    name: name.clone(),
                    value: value_text(param.get("example")),
                    disabled: param.get("disabled").and_then(Value::as_bool) == Some(true),
                    description: param
                        .get("description")
                        .and_then(Value::as_str)
                        .filter(|d| !d.is_empty())
                        .map(str::to_string),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn is_absolute_url(text: &str) -> bool {
    text.contains("://")
}

/// OpenAPI path keys are paths; a request that addresses an absolute URL
/// contributes only its path component.
fn openapi_path(endpoint: &Endpoint) -> String {
    let source = endpoint.url.as_deref().unwrap_or(&endpoint.path);
    match source.split_once("://") {
        Some((_, rest)) => rest
            .find('/')
            .and_then(|start| rest[start..].split('?').next())
            .unwrap_or("/")
            .to_string(),
        None => source.to_string(),
    }
}

pub(crate) fn collection_to_openapi(collection: &Collection) -> (Value, Vec<String>) {
    let mut paths: HashMap<String, HashMap<String, Value>> = HashMap::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut tag_names: Vec<String> = Vec::new();

    for endpoint in &collection.endpoints {
        if !is_http_method(&endpoint.method) {
            skipped.push(endpoint.name.clone());
            continue;
        }
        for tag in &endpoint.tags {
            if !tag_names.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                tag_names.push(tag.clone());
            }
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
        if !endpoint.tags.is_empty() {
            operation["tags"] = serde_json::json!(endpoint.tags);
        }

        if let Some(params) = &endpoint.parameters {
            let params = parameters_to_openapi(params);
            if !params.is_empty() {
                operation["parameters"] = Value::Array(params);
            }
        }

        if let Some(body) = request_body_to_openapi(endpoint) {
            operation["requestBody"] = body;
        }

        if let Some(responses) = &endpoint.responses {
            operation["responses"] =
                serde_json::to_value(responses).unwrap_or(Value::Object(Map::new()));
        } else if let Some(schema) = &endpoint.response_schema {
            operation["responses"]["200"]["content"]["application/json"]["schema"] = schema.clone();
        }

        paths
            .entry(openapi_path(endpoint))
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
    if !tag_names.is_empty() {
        spec["tags"] = Value::Array(
            tag_names
                .into_iter()
                .map(|name| serde_json::json!({ "name": name }))
                .collect(),
        );
    }

    (spec, skipped)
}

/// Flattens the app's `{ path, query, header }` parameter groups into an
/// OpenAPI `parameters` array.
fn parameters_to_openapi(params: &Value) -> Vec<Value> {
    ["path", "query", "header"]
        .into_iter()
        .filter_map(|location| Some((location, params.get(location)?.as_object()?)))
        .flat_map(|(location, group)| {
            group
                .iter()
                .filter(|(_, param)| param.get("disabled").and_then(Value::as_bool) != Some(true))
                .map(move |(name, param)| {
                    let required = location == "path"
                        || param.get("required").and_then(Value::as_bool) == Some(true);
                    let mut parameter = serde_json::json!({
                        "name": name,
                        "in": location,
                        "required": required,
                        "schema": param
                            .get("schema")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({ "type": "string" })),
                    });
                    if let Some(description) = param.get("description") {
                        parameter["description"] = description.clone();
                    }
                    if let Some(example) = param.get("example").filter(|e| e.as_str() != Some("")) {
                        parameter["example"] = example.clone();
                    }
                    parameter
                })
        })
        .collect()
}

/// Converts the request body into an OpenAPI `requestBody`. A raw body that
/// is not JSON is exported as `text/plain`; a form body becomes an object
/// schema under its media type; a binary body is a `format: binary` string.
fn request_body_to_openapi(endpoint: &Endpoint) -> Option<Value> {
    let schema = endpoint
        .request_body
        .as_ref()
        .and_then(|b| b.get("schema"))
        .cloned();
    match effective_body(endpoint) {
        Some(LiveBody::Raw(text)) => {
            let parsed = serde_json::from_str::<Value>(&text).ok();
            if schema.is_none() && parsed.is_none() {
                return Some(
                    serde_json::json!({ "content": { "text/plain": { "example": text } } }),
                );
            }
            let mut media = Map::new();
            if let Some(schema) = schema {
                media.insert("schema".to_string(), schema);
            }
            if let Some(parsed) = parsed {
                media.insert("example".to_string(), parsed);
            }
            Some(serde_json::json!({ "content": { "application/json": media } }))
        }
        Some(LiveBody::Form { urlencoded, rows }) => {
            let mut properties = Map::new();
            let mut example = Map::new();
            for row in rows.iter().filter(|row| row.enabled) {
                if row.file_path.is_some() {
                    properties.insert(
                        row.key.clone(),
                        serde_json::json!({ "type": "string", "format": "binary" }),
                    );
                } else {
                    properties.insert(row.key.clone(), serde_json::json!({ "type": "string" }));
                    example.insert(row.key.clone(), Value::String(row.value.clone()));
                }
            }
            if properties.is_empty() {
                return None;
            }
            let media_type = if urlencoded {
                "application/x-www-form-urlencoded"
            } else {
                "multipart/form-data"
            };
            let mut media =
                serde_json::json!({ "schema": { "type": "object", "properties": properties } });
            if !example.is_empty() {
                media["example"] = Value::Object(example);
            }
            Some(serde_json::json!({ "content": { media_type: media } }))
        }
        Some(LiveBody::Binary { content_type, .. }) => {
            let media_type = if content_type.is_empty() {
                "application/octet-stream".to_string()
            } else {
                content_type
            };
            Some(serde_json::json!({
                "content": { media_type: { "schema": { "type": "string", "format": "binary" } } }
            }))
        }
        None => schema.map(
            |schema| serde_json::json!({ "content": { "application/json": { "schema": schema } } }),
        ),
    }
}

fn endpoint_to_postman_item(collection: &Collection, endpoint: &Endpoint) -> Value {
    let mut request = serde_json::json!({
        "method": endpoint.method,
        "url": postman_url(collection, endpoint)
    });

    if let Some(description) = endpoint
        .description
        .as_ref()
        .filter(|d| !d.trim().is_empty())
    {
        request["description"] = Value::String(description.clone());
    }

    let headers = headers_to_postman(endpoint);
    if !headers.is_empty() {
        request["header"] = Value::Array(headers);
    }

    if let Some(body) = body_to_postman(endpoint) {
        request["body"] = body;
    }

    if let Some(auth) = endpoint_auth_to_postman(endpoint) {
        request["auth"] = auth;
    }

    let mut item = serde_json::json!({
        "name": endpoint.name,
        "request": request
    });

    let events = endpoint_events_to_postman(endpoint);
    if !events.is_empty() {
        item["event"] = Value::Array(events);
    }

    item
}

/// Postman's structured `url`: `raw` plus the split host/path, the query rows
/// and the path variables. `{{name}}` path placeholders become Postman's
/// `:name` so they round-trip as path variables rather than literal text.
fn postman_url(collection: &Collection, endpoint: &Endpoint) -> Value {
    let mut base = match endpoint.url.as_deref() {
        Some(url) => url.to_string(),
        None if is_absolute_url(&endpoint.path) || collection.base_url.is_none() => {
            endpoint.path.clone()
        }
        None => format!("{{{{baseUrl}}}}{}", endpoint.path),
    };
    let path_vars = param_rows(endpoint, "path");
    for row in &path_vars {
        base = base.replace(&format!("{{{{{}}}}}", row.name), &format!(":{}", row.name));
    }

    let query_rows = param_rows(endpoint, "query");
    let query_string: Vec<String> = query_rows
        .iter()
        .filter(|row| !row.disabled)
        .map(|row| {
            if row.value.is_empty() {
                row.name.clone()
            } else {
                format!("{}={}", row.name, row.value)
            }
        })
        .collect();
    let raw = if query_string.is_empty() {
        base.clone()
    } else {
        let separator = if base.contains('?') { "&" } else { "?" };
        format!("{}{}{}", base, separator, query_string.join("&"))
    };

    let mut url = Map::new();
    url.insert("raw".to_string(), Value::String(raw));

    let (protocol, rest) = match base.split_once("://") {
        Some((protocol, rest)) => (Some(protocol), rest),
        None => (None, base.as_str()),
    };
    if let Some(protocol) = protocol {
        url.insert("protocol".to_string(), Value::String(protocol.to_string()));
    }
    let rest = rest.split('?').next().unwrap_or(rest);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    if !host.is_empty() {
        url.insert(
            "host".to_string(),
            serde_json::json!(host.split('.').collect::<Vec<_>>()),
        );
    }
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if !segments.is_empty() {
        url.insert("path".to_string(), serde_json::json!(segments));
    }

    if !query_rows.is_empty() {
        let query: Vec<Value> = query_rows
            .iter()
            .map(|row| {
                let mut entry = serde_json::json!({ "key": row.name, "value": row.value });
                if row.disabled {
                    entry["disabled"] = Value::Bool(true);
                }
                if let Some(description) = &row.description {
                    entry["description"] = Value::String(description.clone());
                }
                entry
            })
            .collect();
        url.insert("query".to_string(), Value::Array(query));
    }
    if !path_vars.is_empty() {
        let variables: Vec<Value> = path_vars
            .iter()
            .map(|row| {
                let mut entry = serde_json::json!({ "key": row.name, "value": row.value });
                if let Some(description) = &row.description {
                    entry["description"] = Value::String(description.clone());
                }
                entry
            })
            .collect();
        url.insert("variable".to_string(), Value::Array(variables));
    }

    Value::Object(url)
}

fn headers_to_postman(endpoint: &Endpoint) -> Vec<Value> {
    param_rows(endpoint, "header")
        .into_iter()
        .map(|row| {
            let mut entry =
                serde_json::json!({ "key": row.name, "value": row.value, "type": "text" });
            if row.disabled {
                entry["disabled"] = Value::Bool(true);
            }
            if let Some(description) = row.description {
                entry["description"] = Value::String(description);
            }
            entry
        })
        .collect()
}

fn body_to_postman(endpoint: &Endpoint) -> Option<Value> {
    let graphql_body = endpoint
        .graphql_data
        .as_ref()
        .filter(|g| g.get("mode").and_then(|m| m.as_str()) == Some("graphql"));
    if let Some(graphql) = graphql_body {
        return Some(serde_json::json!({
            "mode": "graphql",
            "graphql": {
                "query": graphql.get("query").and_then(|q| q.as_str()).unwrap_or(""),
                "variables": graphql.get("variables").and_then(|v| v.as_str()).unwrap_or("")
            }
        }));
    }

    match effective_body(endpoint)? {
        LiveBody::Raw(text) => {
            let mut body = serde_json::json!({ "mode": "raw", "raw": text });
            if serde_json::from_str::<Value>(&text).is_ok() {
                body["options"] = serde_json::json!({ "raw": { "language": "json" } });
            }
            Some(body)
        }
        LiveBody::Form { urlencoded, rows } => {
            let mode = if urlencoded { "urlencoded" } else { "formdata" };
            let entries: Vec<Value> = rows
                .iter()
                .map(|row| {
                    let mut entry = serde_json::json!({ "key": row.key });
                    match &row.file_path {
                        Some(file_path) => {
                            entry["type"] = Value::String("file".to_string());
                            entry["src"] = Value::String(file_path.clone());
                        }
                        None => {
                            entry["type"] = Value::String("text".to_string());
                            entry["value"] = Value::String(row.value.clone());
                        }
                    }
                    if !row.enabled {
                        entry["disabled"] = Value::Bool(true);
                    }
                    entry
                })
                .collect();
            Some(serde_json::json!({ "mode": mode, mode: entries }))
        }
        LiveBody::Binary { file_path, .. } => {
            Some(serde_json::json!({ "mode": "file", "file": { "src": file_path } }))
        }
    }
}

/// Serialize the endpoint's scripts into Postman `event[]` entries. Inherited
/// collection/folder blocks imported earlier export as part of the request
/// script (deliberate asymmetry; the app has no collection-level scripts).
fn endpoint_events_to_postman(endpoint: &Endpoint) -> Vec<Value> {
    let Some(scripts) = endpoint
        .scripts
        .clone()
        .and_then(|s| serde_json::from_value::<ScriptData>(s).ok())
    else {
        return Vec::new();
    };

    let mut events = Vec::new();
    for (listen, script) in [
        ("prerequest", &scripts.pre_request_script),
        ("test", &scripts.test_script),
    ] {
        if !script.is_empty() {
            let exec: Vec<&str> = script.split('\n').collect();
            events.push(serde_json::json!({
                "listen": listen,
                "script": { "type": "text/javascript", "exec": exec }
            }));
        }
    }
    events
}

fn endpoint_auth_to_postman(endpoint: &Endpoint) -> Option<Value> {
    scoped_auth_to_postman(endpoint.security.as_ref())
}

/// Maps a request's or folder's auth config to Postman `auth`. Unlike the
/// collection root, an explicit "none" is meaningful at these scopes (it opts
/// out of the inherited auth) and round-trips as `noauth`; "inherit" is
/// Postman's default and is omitted.
fn scoped_auth_to_postman(auth_config: Option<&Value>) -> Option<Value> {
    let cfg = auth_config?;
    match cfg.get("type").and_then(|v| v.as_str()) {
        None | Some("inherit") => None,
        Some("none") => Some(serde_json::json!({ "type": "noauth" })),
        _ => auth_to_postman(cfg),
    }
}

/// Maps a stored auth config ({type, config}) to the Postman `auth` object
/// shape. Used for both per-request auth and collection-level auth.
fn auth_to_postman(security: &Value) -> Option<Value> {
    let auth_type = security.get("type").and_then(|v| v.as_str())?;
    let config = security.get("config");
    let get = |key: &str| {
        config
            .and_then(|c| c.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
    };

    match auth_type {
        "bearer" => {
            let token = get("token").unwrap_or("");
            Some(serde_json::json!({
                "type": "bearer",
                "bearer": [{ "key": "token", "value": token, "type": "string" }]
            }))
        }
        "basic" | "digest" | "ntlm" => {
            let keys: &[&str] = if auth_type == "ntlm" {
                &["username", "password", "domain", "workstation"]
            } else {
                &["username", "password"]
            };
            let params: Vec<Value> = keys
                .iter()
                .map(|key| {
                    serde_json::json!({ "key": key, "value": get(key).unwrap_or(""), "type": "string" })
                })
                .collect();
            Some(serde_json::json!({ "type": auth_type, (auth_type): params }))
        }
        "api-key" => {
            let key = get("keyName").or_else(|| get("key")).unwrap_or("");
            let value = get("keyValue").or_else(|| get("value")).unwrap_or("");
            let location = get("location").unwrap_or("header");
            Some(serde_json::json!({
                "type": "apikey",
                "apikey": [
                    { "key": "key", "value": key, "type": "string" },
                    { "key": "value", "value": value, "type": "string" },
                    { "key": "in", "value": location, "type": "string" }
                ]
            }))
        }
        "oauth2" => oauth2_to_postman(config),
        _ => None,
    }
}

/// Inverse of the importer's oauth2 mapping. Manual-token configs have no
/// Postman grant_type equivalent, so only the token fields are emitted.
fn oauth2_to_postman(config: Option<&Value>) -> Option<Value> {
    let get = |key: &str| {
        config
            .and_then(|c| c.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
    };

    let grant_type = get("grantType").unwrap_or("");
    let use_pkce = config
        .and_then(|c| c.get("usePkce"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let mut params: Vec<Value> = Vec::new();
    let postman_grant = match grant_type {
        "authorization_code" if use_pkce => Some("authorization_code_with_pkce"),
        "authorization_code" => Some("authorization_code"),
        "client_credentials" => Some("client_credentials"),
        "password" => Some("password_credentials"),
        _ => None,
    };
    if let Some(grant) = postman_grant {
        params.push(serde_json::json!({ "key": "grant_type", "value": grant, "type": "string" }));
    }

    let manual = postman_grant.is_none();
    for (postman_key, app_key) in super::storage::OAUTH2_KEY_MAP {
        if manual && !matches!(postman_key, "accessToken" | "headerPrefix") {
            continue;
        }
        if let Some(value) = get(app_key) {
            params
                .push(serde_json::json!({ "key": postman_key, "value": value, "type": "string" }));
        }
    }

    if params.is_empty() {
        return None;
    }
    Some(serde_json::json!({ "type": "oauth2", "oauth2": params }))
}

/// Place a folder's exported items into a nested Postman item tree derived
/// from the composite folder name segments ("Parent / Child"). A user folder
/// literally named "A / B" therefore exports as nested folders A > B.
fn insert_into_item_tree(
    items: &mut Vec<Value>,
    segments: &[&str],
    folder_items: Vec<Value>,
    folder_auth: Option<&Value>,
) {
    let Some((name, rest)) = segments.split_first() else {
        items.extend(folder_items);
        return;
    };

    let position = items.iter().position(|item| {
        item.get("name").and_then(|n| n.as_str()) == Some(*name) && item.get("item").is_some()
    });
    let node = match position {
        Some(position) => &mut items[position],
        None => {
            items.push(serde_json::json!({ "name": name, "item": [] }));
            items.last_mut().unwrap()
        }
    };

    if rest.is_empty()
        && let Some(auth) = folder_auth
    {
        node["auth"] = auth.clone();
    }

    let children = node
        .get_mut("item")
        .and_then(|i| i.as_array_mut())
        .expect("folder node has an item array");
    insert_into_item_tree(children, rest, folder_items, folder_auth);
}

pub(crate) fn collection_to_postman(collection: &Collection) -> (Value, Vec<String>) {
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
            let segments: Vec<&str> = folder.name.split(" / ").collect();
            let folder_auth = scoped_auth_to_postman(folder.auth_config.as_ref());
            insert_into_item_tree(&mut items, &segments, folder_items, folder_auth.as_ref());
        }
    }

    // Top-level endpoints (foldered ones also appear in the flat list; skip those)
    let folder_endpoint_ids: HashSet<&str> = collection
        .folders
        .iter()
        .flat_map(|f| f.endpoints.iter().map(|e| e.id.as_str()))
        .collect();
    for endpoint in &collection.endpoints {
        if folder_endpoint_ids.contains(endpoint.id.as_str()) {
            continue;
        }
        if !is_http_method(&endpoint.method) {
            skipped.push(endpoint.name.clone());
            continue;
        }
        items.push(endpoint_to_postman_item(collection, endpoint));
    }

    let mut variables: Vec<Value> = Vec::new();
    let mut has_base_url_variable = false;
    if let Some(entries) = &collection.variables {
        for entry in entries {
            if entry.key.eq_ignore_ascii_case("baseurl")
                || entry.key.eq_ignore_ascii_case("base_url")
            {
                has_base_url_variable = true;
            }
            variables.push(serde_json::json!({
                "key": entry.key,
                "value": entry.value,
                "type": "string"
            }));
        }
    }
    if !has_base_url_variable
        && let Some(base_url) = collection.base_url.as_ref().filter(|s| !s.is_empty())
    {
        variables.push(serde_json::json!({
            "key": "baseUrl",
            "value": base_url,
            "type": "string"
        }));
    }

    let mut postman = serde_json::json!({
        "info": {
            "name": collection.name,
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        "item": items,
        "variable": variables
    });

    if let Some(auth) = collection
        .auth_config
        .as_ref()
        .filter(|cfg| {
            !matches!(
                cfg.get("type").and_then(|v| v.as_str()),
                None | Some("none") | Some("inherit")
            )
        })
        .and_then(auth_to_postman)
    {
        postman["auth"] = auth;
    }

    (postman, skipped)
}

#[cfg(test)]
mod tests {
    use super::super::postman::parse_postman_collection;
    use super::*;

    fn endpoint(name: &str, method: &str) -> Endpoint {
        Endpoint {
            id: format!("id-{}", name),
            name: name.to_string(),
            method: method.to_string(),
            path: format!("/{}", name.to_lowercase().replace(' ', "-")),
            description: None,
            tags: Vec::new(),
            parameters: None,
            request_body: None,
            responses: None,
            security: None,
            scripts: None,
            graphql_data: None,
            url: None,
            live_body: None,
            response_schema: None,
        }
    }

    fn stored(data: Value) -> storage_collections::EndpointData {
        let mut stored = storage_collections::EndpointData::default();
        let rows = |key: &str| {
            data.get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        };
        stored.path_params = rows("pathParams");
        stored.query_params = rows("queryParams");
        stored.headers = rows("headers");
        stored.modified_body = data
            .get("modifiedBody")
            .and_then(Value::as_str)
            .map(str::to_string);
        stored.form_body_data = data.get("formBodyData").cloned();
        stored.auth_config = data.get("authConfig").cloned();
        stored.url = data.get("url").and_then(Value::as_str).map(str::to_string);
        stored.response_schema = data.get("responseSchema").cloned();
        stored.scripts = data.get("scripts").cloned();
        stored.graphql_data = data.get("graphqlData").cloned();
        stored
    }

    fn single(endpoint: Endpoint, base_url: Option<&str>) -> Collection {
        Collection {
            id: "col".to_string(),
            name: "Live".to_string(),
            description: None,
            base_url: base_url.map(str::to_string),
            endpoints: vec![endpoint],
            folders: Vec::new(),
            variables: None,
            auth_config: None,
        }
    }

    #[test]
    fn export_emits_events_graphql_variables_and_nested_folders_without_duplicates() {
        let mut scripted = endpoint("List Users", "GET");
        scripted.scripts = Some(serde_json::json!({
            "preRequestScript": "console.log('a');\nconsole.log('b');",
            "testScript": "expect(response.status).toBe(200);"
        }));

        let mut graphql = endpoint("Get Things", "POST");
        graphql.graphql_data = Some(serde_json::json!({
            "mode": "graphql",
            "query": "query { things }",
            "variables": "{\"x\":1}"
        }));

        let mut api_key = endpoint("Secure", "GET");
        api_key.security = Some(serde_json::json!({
            "type": "api-key",
            "config": { "keyName": "X-Api-Key", "keyValue": "abc", "location": "header" }
        }));

        let collection = Collection {
            id: "col".to_string(),
            name: "Test".to_string(),
            description: None,
            base_url: Some("https://api.example.com".to_string()),
            endpoints: vec![scripted.clone(), graphql, api_key],
            folders: vec![Folder {
                id: "folder_Parent___Child".to_string(),
                name: "Parent / Child".to_string(),
                endpoints: vec![scripted],
                auth_config: Some(serde_json::json!({
                    "type": "basic",
                    "config": { "username": "folder-user", "password": "" }
                })),
            }],
            variables: Some(vec![VariableEntry {
                key: "apiKey".to_string(),
                value: "secret".to_string(),
            }]),
            auth_config: Some(serde_json::json!({
                "type": "bearer",
                "config": { "token": "{{token}}" }
            })),
        };

        let (postman, skipped) = collection_to_postman(&collection);
        assert!(skipped.is_empty());

        assert_eq!(postman["auth"]["type"], "bearer");
        assert_eq!(postman["auth"]["bearer"][0]["value"], "{{token}}");

        let items = postman["item"].as_array().unwrap();
        assert_eq!(items.len(), 3);

        let parent = items.iter().find(|i| i["name"] == "Parent").unwrap();
        let child = &parent["item"][0];
        assert_eq!(child["name"], "Child");
        assert_eq!(child["auth"]["type"], "basic");
        assert!(parent.get("auth").is_none());
        let exported_scripted = &child["item"][0];
        assert_eq!(exported_scripted["name"], "List Users");
        let events = exported_scripted["event"].as_array().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["listen"], "prerequest");
        assert_eq!(
            events[0]["script"]["exec"],
            serde_json::json!(["console.log('a');", "console.log('b');"])
        );
        assert_eq!(events[1]["listen"], "test");

        let exported_graphql = items.iter().find(|i| i["name"] == "Get Things").unwrap();
        assert_eq!(exported_graphql["request"]["body"]["mode"], "graphql");
        assert_eq!(
            exported_graphql["request"]["body"]["graphql"]["query"],
            "query { things }"
        );

        let exported_api_key = items.iter().find(|i| i["name"] == "Secure").unwrap();
        let apikey = exported_api_key["request"]["auth"]["apikey"]
            .as_array()
            .unwrap();
        assert!(
            apikey
                .iter()
                .any(|p| p["key"] == "key" && p["value"] == "X-Api-Key")
        );
        assert!(
            apikey
                .iter()
                .any(|p| p["key"] == "value" && p["value"] == "abc")
        );

        let variables = postman["variable"].as_array().unwrap();
        assert_eq!(variables[0]["key"], "apiKey");
        assert_eq!(variables[1]["key"], "baseUrl");
        assert_eq!(variables[1]["value"], "https://api.example.com");
    }

    #[test]
    fn postman_import_export_round_trips() {
        let fixture = serde_json::json!({
            "info": { "name": "RoundTrip" },
            "auth": {
                "type": "bearer",
                "bearer": [{ "key": "token", "value": "{{token}}", "type": "string" }]
            },
            "variable": [
                { "key": "baseUrl", "value": "https://api.example.com" },
                { "key": "token", "value": "abc" }
            ],
            "item": [
                {
                    "name": "Users",
                    "auth": {
                        "type": "basic",
                        "basic": [
                            { "key": "username", "value": "folder-user", "type": "string" },
                            { "key": "password", "value": "{{folderPass}}", "type": "string" }
                        ]
                    },
                    "item": [
                        {
                            "name": "Admin",
                            "item": [
                                {
                                    "name": "Delete User",
                                    "event": [
                                        { "listen": "test", "script": { "exec": ["expect(1).toBe(1);"] } }
                                    ],
                                    "request": {
                                        "method": "DELETE",
                                        "url": "https://api.example.com/users/1",
                                        "auth": {
                                            "type": "oauth2",
                                            "oauth2": [
                                                { "key": "grant_type", "value": "client_credentials" },
                                                { "key": "accessTokenUrl", "value": "https://auth.example.com/token" },
                                                { "key": "clientId", "value": "client-1" }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }
                    ]
                },
                {
                    "name": "GraphQL",
                    "request": {
                        "method": "POST",
                        "url": "https://api.example.com/graphql",
                        "body": {
                            "mode": "graphql",
                            "graphql": { "query": "query { a }", "variables": "" }
                        }
                    }
                }
            ]
        });

        let imported = parse_postman_collection(fixture).unwrap();
        let imported_auth = imported.auth_config.as_ref().unwrap();
        assert_eq!(imported_auth["type"], "bearer");
        assert_eq!(imported_auth["config"]["token"], "{{token}}");

        let (exported, skipped) = collection_to_postman(&imported);
        assert!(skipped.is_empty());
        assert_eq!(exported["auth"]["type"], "bearer");
        let reimported = parse_postman_collection(exported).unwrap();
        assert_eq!(
            reimported.auth_config.as_ref().unwrap()["config"]["token"],
            "{{token}}"
        );

        assert_eq!(reimported.folders.len(), 1);
        assert_eq!(reimported.folders[0].name, "Users / Admin");
        let folder_auth = reimported.folders[0].auth_config.as_ref().unwrap();
        assert_eq!(folder_auth["type"], "basic");
        assert_eq!(folder_auth["config"]["username"], "folder-user");
        assert_eq!(folder_auth["config"]["password"], "{{folderPass}}");

        let delete_user = reimported
            .endpoints
            .iter()
            .find(|e| e.name == "Delete User")
            .unwrap();
        let scripts: ScriptData =
            serde_json::from_value(delete_user.scripts.clone().unwrap()).unwrap();
        assert_eq!(scripts.test_script, "expect(1).toBe(1);");
        assert_eq!(scripts.pre_request_script, "");
        let config = &delete_user.security.as_ref().unwrap()["config"];
        assert_eq!(config["grantType"], "client_credentials");
        assert_eq!(config["tokenUrl"], "https://auth.example.com/token");
        assert_eq!(config["clientId"], "client-1");

        let graphql = reimported
            .endpoints
            .iter()
            .find(|e| e.name == "GraphQL")
            .unwrap();
        assert_eq!(
            graphql.graphql_data.as_ref().unwrap()["query"],
            "query { a }"
        );

        let variables = reimported.variables.unwrap();
        let pairs: Vec<(&str, &str)> = variables
            .iter()
            .map(|v| (v.key.as_str(), v.value.as_str()))
            .collect();
        assert_eq!(
            pairs,
            vec![("baseUrl", "https://api.example.com"), ("token", "abc")]
        );
    }

    #[test]
    fn ntlm_auth_round_trips_through_postman() {
        let mut secured = endpoint("Intranet", "GET");
        secured.security = Some(serde_json::json!({
            "type": "ntlm",
            "config": {
                "username": "ada",
                "password": "{{ntlmPass}}",
                "domain": "CORP",
                "workstation": "DEV-BOX"
            }
        }));

        let postman = endpoint_auth_to_postman(&secured).unwrap();
        assert_eq!(postman["type"], "ntlm");
        let params = postman["ntlm"].as_array().unwrap();
        let get = |key: &str| {
            params
                .iter()
                .find(|p| p["key"] == key)
                .and_then(|p| p["value"].as_str())
                .unwrap_or("")
        };
        assert_eq!(get("username"), "ada");
        assert_eq!(get("password"), "{{ntlmPass}}");
        assert_eq!(get("domain"), "CORP");
        assert_eq!(get("workstation"), "DEV-BOX");

        let fixture = serde_json::json!({
            "info": { "name": "NTLM" },
            "item": [{
                "name": "Intranet",
                "request": {
                    "method": "GET",
                    "url": "https://intranet.example.com/api",
                    "auth": postman
                }
            }]
        });
        let imported = parse_postman_collection(fixture).unwrap();
        let config = &imported.endpoints[0].security.as_ref().unwrap()["config"];
        assert_eq!(config["username"], "ada");
        assert_eq!(config["password"], "{{ntlmPass}}");
        assert_eq!(config["domain"], "CORP");
        assert_eq!(config["workstation"], "DEV-BOX");
    }

    #[test]
    fn openapi_export_writes_spec_shaped_parameters_and_bodies() {
        let mut create = endpoint("Create Item", "POST");
        create.path = "/items/{id}".to_string();
        create.parameters = Some(serde_json::json!({
            "path": { "id": { "example": "7" } },
            "query": { "dry": { "example": "", "description": "No writes", "required": true } },
            "header": { "X-Trace": { "example": "abc" } }
        }));
        create.request_body = Some(serde_json::json!({ "example": "{\"name\": \"a\"}" }));
        create.tags = vec!["Pets".to_string(), "smoke".to_string()];
        let mut note = endpoint("Note", "PUT");
        note.request_body = Some(serde_json::json!({ "example": "plain words" }));
        let mut empty = endpoint("Empty", "POST");
        empty.request_body = Some(serde_json::json!({ "example": "" }));

        let collection = Collection {
            id: "col".to_string(),
            name: "Spec".to_string(),
            description: None,
            base_url: None,
            endpoints: vec![create, note, empty],
            folders: Vec::new(),
            variables: None,
            auth_config: None,
        };
        let (spec, _) = collection_to_openapi(&collection);

        let post = &spec["paths"]["/items/{id}"]["post"];
        assert_eq!(
            post["parameters"],
            serde_json::json!([
                { "name": "id", "in": "path", "required": true, "schema": { "type": "string" }, "example": "7" },
                { "name": "dry", "in": "query", "required": true, "schema": { "type": "string" }, "description": "No writes" },
                { "name": "X-Trace", "in": "header", "required": false, "schema": { "type": "string" }, "example": "abc" }
            ])
        );
        assert_eq!(
            post["requestBody"],
            serde_json::json!({ "content": { "application/json": { "example": { "name": "a" } } } })
        );
        assert_eq!(
            spec["paths"]["/note"]["put"]["requestBody"],
            serde_json::json!({ "content": { "text/plain": { "example": "plain words" } } })
        );
        assert!(spec["paths"]["/empty"]["post"].get("requestBody").is_none());
        assert_eq!(post["tags"], serde_json::json!(["Pets", "smoke"]));
        assert!(spec["paths"]["/note"]["put"].get("tags").is_none());
        assert_eq!(
            spec["tags"],
            serde_json::json!([{ "name": "Pets" }, { "name": "smoke" }])
        );
    }

    #[test]
    fn saved_rows_body_auth_and_schema_override_the_spec_in_both_exports() {
        let mut create = endpoint("Create Item", "POST");
        create.path = "/items/{{id}}".to_string();
        create.description = Some("Creates one item".to_string());
        create.parameters = Some(serde_json::json!({
            "path": { "id": { "example": "1", "description": "Item id" } },
            "query": { "page": { "example": "1" } },
            "header": { "X-Trace": { "example": "spec", "description": "Trace id" } }
        }));
        create.request_body = Some(serde_json::json!({
            "example": "{\"name\": \"spec\"}",
            "schema": { "type": "object" }
        }));
        apply_live_state(
            &mut create,
            &stored(serde_json::json!({
                "pathParams": [{ "key": "id", "value": "7" }],
                "queryParams": [
                    { "key": "page", "value": "2", "enabled": true },
                    { "key": "verbose", "value": "", "enabled": true }
                ],
                "headers": [
                    { "key": "X-Trace", "value": "live", "enabled": true },
                    { "key": "X-Off", "value": "x", "enabled": false }
                ],
                "modifiedBody": "{\"name\": \"live\"}",
                "authConfig": { "type": "bearer", "config": { "token": "{{token}}" } },
                "responseSchema": { "type": "object", "required": ["id"] }
            })),
        );
        let collection = single(create, Some("https://api.example.com"));

        let (postman, skipped) = collection_to_postman(&collection);
        assert!(skipped.is_empty());
        let request = &postman["item"][0]["request"];
        assert_eq!(request["description"], "Creates one item");
        assert_eq!(
            request["url"]["raw"],
            "{{baseUrl}}/items/:id?page=2&verbose"
        );
        assert_eq!(request["url"]["host"], serde_json::json!(["{{baseUrl}}"]));
        assert_eq!(request["url"]["path"], serde_json::json!(["items", ":id"]));
        assert_eq!(
            request["url"]["variable"],
            serde_json::json!([{ "key": "id", "value": "7", "description": "Item id" }])
        );
        assert_eq!(
            request["url"]["query"],
            serde_json::json!([
                { "key": "page", "value": "2" },
                { "key": "verbose", "value": "" }
            ])
        );
        assert_eq!(
            request["header"],
            serde_json::json!([
                { "key": "X-Trace", "value": "live", "type": "text", "description": "Trace id" },
                { "key": "X-Off", "value": "x", "type": "text", "disabled": true }
            ])
        );
        assert_eq!(request["body"]["mode"], "raw");
        assert_eq!(request["body"]["raw"], "{\"name\": \"live\"}");
        assert_eq!(request["body"]["options"]["raw"]["language"], "json");
        assert_eq!(request["auth"]["type"], "bearer");
        assert_eq!(request["auth"]["bearer"][0]["value"], "{{token}}");

        let reimported = parse_postman_collection(postman).unwrap();
        let params = reimported.endpoints[0].parameters.as_ref().unwrap();
        assert_eq!(params["path"]["id"]["example"], "7");
        assert_eq!(params["query"]["page"]["example"], "2");
        assert_eq!(params["header"]["X-Trace"]["example"], "live");
        assert!(params["header"].get("X-Off").is_none());
        assert_eq!(
            reimported.endpoints[0].security.as_ref().unwrap()["config"]["token"],
            "{{token}}"
        );

        let (spec, _) = collection_to_openapi(&collection);
        let post = &spec["paths"]["/items/{{id}}"]["post"];
        assert_eq!(
            post["parameters"],
            serde_json::json!([
                { "name": "id", "in": "path", "required": true, "schema": { "type": "string" }, "description": "Item id", "example": "7" },
                { "name": "page", "in": "query", "required": false, "schema": { "type": "string" }, "example": "2" },
                { "name": "verbose", "in": "query", "required": false, "schema": { "type": "string" } },
                { "name": "X-Trace", "in": "header", "required": false, "schema": { "type": "string" }, "description": "Trace id", "example": "live" }
            ])
        );
        assert_eq!(
            post["requestBody"]["content"]["application/json"],
            serde_json::json!({ "schema": { "type": "object" }, "example": { "name": "live" } })
        );
        assert_eq!(
            post["responses"]["200"]["content"]["application/json"]["schema"],
            serde_json::json!({ "type": "object", "required": ["id"] })
        );
    }

    #[test]
    fn form_text_binary_and_imported_form_bodies_export_in_both_formats() {
        let mut multipart = endpoint("Upload", "POST");
        apply_live_state(
            &mut multipart,
            &stored(serde_json::json!({
                "formBodyData": {
                    "mode": "formdata",
                    "fields": [
                        { "key": "avatar", "value": "", "type": "file", "filePath": "/tmp/a.png", "enabled": true },
                        { "key": "name", "value": "ada", "type": "text", "enabled": true },
                        { "key": "old", "value": "x", "type": "text", "enabled": false }
                    ]
                }
            })),
        );
        let mut urlencoded = endpoint("Token", "POST");
        apply_live_state(
            &mut urlencoded,
            &stored(serde_json::json!({
                "formBodyData": {
                    "mode": "urlencoded",
                    "fields": [{ "key": "grant_type", "value": "client_credentials" }]
                }
            })),
        );
        let mut text = endpoint("Note", "PUT");
        apply_live_state(
            &mut text,
            &stored(serde_json::json!({
                "formBodyData": { "mode": "text", "content": "hello" },
                "modifiedBody": "{\"stale\": true}"
            })),
        );
        let mut binary = endpoint("Blob", "PUT");
        apply_live_state(
            &mut binary,
            &stored(serde_json::json!({
                "formBodyData": { "mode": "binary", "filePath": "/tmp/b.bin", "contentType": "image/png" }
            })),
        );
        let mut imported = endpoint("Imported", "POST");
        imported.request_body =
            Some(serde_json::json!({ "type": "formdata", "fields": { "a": "1" } }));

        let collection = Collection {
            id: "col".to_string(),
            name: "Bodies".to_string(),
            description: None,
            base_url: None,
            endpoints: vec![multipart, urlencoded, text, binary, imported],
            folders: Vec::new(),
            variables: None,
            auth_config: None,
        };

        let (postman, _) = collection_to_postman(&collection);
        let body = |name: &str| {
            postman["item"]
                .as_array()
                .unwrap()
                .iter()
                .find(|i| i["name"] == name)
                .unwrap()["request"]["body"]
                .clone()
        };
        assert_eq!(
            body("Upload"),
            serde_json::json!({
                "mode": "formdata",
                "formdata": [
                    { "key": "avatar", "type": "file", "src": "/tmp/a.png" },
                    { "key": "name", "type": "text", "value": "ada" },
                    { "key": "old", "type": "text", "value": "x", "disabled": true }
                ]
            })
        );
        assert_eq!(body("Token")["mode"], "urlencoded");
        assert_eq!(body("Token")["urlencoded"][0]["key"], "grant_type");
        assert_eq!(
            body("Note"),
            serde_json::json!({ "mode": "raw", "raw": "hello" })
        );
        assert_eq!(
            body("Blob"),
            serde_json::json!({ "mode": "file", "file": { "src": "/tmp/b.bin" } })
        );
        assert_eq!(body("Imported")["formdata"][0]["value"], "1");

        let (spec, _) = collection_to_openapi(&collection);
        assert_eq!(
            spec["paths"]["/upload"]["post"]["requestBody"]["content"]["multipart/form-data"],
            serde_json::json!({
                "schema": {
                    "type": "object",
                    "properties": {
                        "avatar": { "type": "string", "format": "binary" },
                        "name": { "type": "string" }
                    }
                },
                "example": { "name": "ada" }
            })
        );
        assert!(
            spec["paths"]["/token"]["post"]["requestBody"]["content"]
                .get("application/x-www-form-urlencoded")
                .is_some()
        );
        assert_eq!(
            spec["paths"]["/note"]["put"]["requestBody"]["content"]["text/plain"]["example"],
            "hello"
        );
        assert_eq!(
            spec["paths"]["/blob"]["put"]["requestBody"]["content"]["image/png"]["schema"],
            serde_json::json!({ "type": "string", "format": "binary" })
        );
    }

    #[test]
    fn absolute_urls_are_not_prefixed_and_openapi_keeps_only_their_path() {
        let mut graphql = endpoint("GraphQL", "POST");
        graphql.path = "https://api.example.com/graphql".to_string();
        let mut overridden = endpoint("Things", "GET");
        overridden.path = "/things".to_string();
        apply_live_state(
            &mut overridden,
            &stored(serde_json::json!({ "url": "https://other.example.com/v2/things?x=1" })),
        );
        let collection = Collection {
            id: "col".to_string(),
            name: "Urls".to_string(),
            description: None,
            base_url: Some("https://api.example.com".to_string()),
            endpoints: vec![graphql, overridden],
            folders: Vec::new(),
            variables: None,
            auth_config: None,
        };

        let (postman, _) = collection_to_postman(&collection);
        let graphql_url = &postman["item"][0]["request"]["url"];
        assert_eq!(graphql_url["raw"], "https://api.example.com/graphql");
        assert_eq!(graphql_url["protocol"], "https");
        assert_eq!(
            graphql_url["host"],
            serde_json::json!(["api", "example", "com"])
        );
        assert_eq!(graphql_url["path"], serde_json::json!(["graphql"]));
        let things_url = &postman["item"][1]["request"]["url"];
        assert_eq!(things_url["raw"], "https://other.example.com/v2/things?x=1");
        assert_eq!(things_url["path"], serde_json::json!(["v2", "things"]));

        let (spec, _) = collection_to_openapi(&collection);
        assert!(spec["paths"].get("/graphql").is_some());
        assert!(spec["paths"].get("/v2/things").is_some());
    }

    #[test]
    fn request_auth_none_exports_as_noauth_and_inherit_is_omitted() {
        let mut opted_out = endpoint("Public", "GET");
        opted_out.security = Some(serde_json::json!({ "type": "none", "config": {} }));
        let mut inherited = endpoint("Inherited", "GET");
        inherited.security = Some(serde_json::json!({ "type": "inherit", "config": {} }));
        let mut blank_bearer = endpoint("Blank", "GET");
        blank_bearer.security =
            Some(serde_json::json!({ "type": "bearer", "config": { "token": "" } }));

        assert_eq!(
            endpoint_auth_to_postman(&opted_out),
            Some(serde_json::json!({ "type": "noauth" }))
        );
        assert_eq!(endpoint_auth_to_postman(&inherited), None);
        assert_eq!(
            endpoint_auth_to_postman(&blank_bearer).unwrap()["bearer"][0]["value"],
            ""
        );
    }

    #[test]
    fn saved_state_without_rows_keeps_the_spec_parameters() {
        let mut get = endpoint("Get", "GET");
        get.parameters = Some(serde_json::json!({ "query": { "q": { "example": "spec" } } }));
        apply_live_state(&mut get, &stored(serde_json::json!({})));

        assert_eq!(get.parameters.unwrap()["query"]["q"]["example"], "spec");
        assert_eq!(get.live_body, None);
        assert_eq!(get.security, None);
    }
}
