//! Serialization of a stored `Collection` into OpenAPI, plus loading a
//! collection from disk for export.

use super::storage::is_http_method;
use super::{Collection, Endpoint, Folder, VariableEntry};
use crate::commands::collections as storage_collections;
use serde_json::{Map, Value};
use std::collections::HashMap;
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

/// Overlay a request's saved state on its export shape: auth, absolute URL,
/// parameter rows, body and response schema. Saved
/// rows replace the spec bucket of the same location, keeping the spec's
/// schema and description for names that still match.
pub(crate) fn apply_live_state(
    endpoint: &mut Endpoint,
    stored: &storage_collections::EndpointData,
) {
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
                if value_text(form.get("filePath")).is_empty() {
                    return None;
                }
                return Some(LiveBody::Binary {
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
        Some(LiveBody::Binary { content_type }) => {
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

#[cfg(test)]
mod tests {
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
            examples: Vec::new(),
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
    fn saved_rows_body_auth_and_schema_override_the_spec_in_openapi_export() {
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
    fn form_text_binary_and_imported_form_bodies_export_to_openapi() {
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
    fn openapi_export_keeps_only_the_path_of_absolute_urls() {
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

        let (spec, _) = collection_to_openapi(&collection);
        assert!(spec["paths"].get("/graphql").is_some());
        assert!(spec["paths"].get("/v2/things").is_some());
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
