//! Insomnia export parsing: converts a v4 JSON or v5 YAML export into a
//! `Collection` plus the export's sub-environments.
//!
//! v4 is a flat `resources[]` list linked by `parentId`; v5 is a nested
//! `collection[]` tree with `children`. The request-level converters (auth,
//! body, headers, template rewrite) are shared between both walks.

use super::common::{derive_base_url, param_map_entry, unique_folder_id, ParsedBody};
use super::{Collection, Endpoint, Folder, VariableEntry};
use crate::commands::scripts::ScriptData;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

#[derive(Debug)]
pub(crate) struct ImportedEnvironment {
    pub name: String,
    pub variables: serde_json::Map<String, Value>,
}

#[derive(Debug)]
pub(crate) struct InsomniaImport {
    pub collection: Collection,
    pub environments: Vec<ImportedEnvironment>,
    /// Non-HTTP requests (WebSocket, gRPC) present in the export but not
    /// imported; surfaced so the user learns nothing vanished silently.
    pub skipped_requests: usize,
}

pub(crate) fn parse_insomnia_export(doc: Value) -> Result<InsomniaImport, String> {
    let is_v4 = doc.get("_type").and_then(|t| t.as_str()) == Some("export")
        || doc
            .get("__export_format")
            .and_then(|f| f.as_i64())
            .is_some();
    if is_v4 {
        return parse_v4(&doc);
    }

    if let Some(doc_type) = doc.get("type").and_then(|t| t.as_str()) {
        if doc_type.starts_with("collection.insomnia.rest/5") {
            return parse_v5(&doc);
        }
        if doc_type.starts_with("environment.insomnia.rest/5") {
            return Err(
                "This is an Insomnia v5 environment export, not a collection. Import it via the environment manager after importing the collection.".to_string(),
            );
        }
    }

    Err(
        "Not a recognized Insomnia export (expected an Insomnia v4 JSON or v5 YAML export)"
            .to_string(),
    )
}

/// Insomnia's Nunjucks environment references: `{{ _.varName }}` → the app's
/// `{{ varName }}`. Compiled once; this runs on every imported string.
static TEMPLATE_PATTERN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"\{\{\s*_\.([A-Za-z0-9_][A-Za-z0-9_.\-]*)\s*\}\}").expect("valid regex")
});

fn rewrite_templates(text: &str) -> String {
    TEMPLATE_PATTERN.replace_all(text, "{{ $1 }}").to_string()
}

fn string_field(owner: &Value, key: &str) -> Option<String> {
    owner
        .get(key)
        .and_then(|v| v.as_str())
        .map(rewrite_templates)
}

// ---------------------------------------------------------------------------
// v4 (flat resources[] linked by parentId)
// ---------------------------------------------------------------------------

fn parse_v4(doc: &Value) -> Result<InsomniaImport, String> {
    let resources = doc
        .get("resources")
        .and_then(|r| r.as_array())
        .ok_or("Insomnia export has no resources")?;

    let ids: HashSet<&str> = resources
        .iter()
        .filter_map(|r| r.get("_id").and_then(|id| id.as_str()))
        .collect();

    // Bucket children by parentId, keeping sibling order stable via metaSortKey
    // when present. Resources whose parent is unknown (partial exports) are
    // treated as roots.
    let mut children: HashMap<&str, Vec<&Value>> = HashMap::new();
    for resource in resources {
        let parent = resource
            .get("parentId")
            .and_then(|p| p.as_str())
            .filter(|p| ids.contains(p))
            .unwrap_or("");
        children.entry(parent).or_default().push(resource);
    }
    for bucket in children.values_mut() {
        bucket.sort_by(|a, b| {
            let key = |r: &&Value| r.get("metaSortKey").and_then(|k| k.as_f64());
            key(a)
                .partial_cmp(&key(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    let workspace = resources
        .iter()
        .filter(|r| r.get("_type").and_then(|t| t.as_str()) == Some("workspace"))
        .max_by_key(|r| r.get("scope").and_then(|s| s.as_str()) == Some("collection"));

    let (name, description, root_id) = match workspace {
        Some(ws) => (
            ws.get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("Imported Insomnia Collection")
                .to_string(),
            ws.get("description")
                .and_then(|d| d.as_str())
                .filter(|d| !d.is_empty())
                .map(|d| d.to_string()),
            ws.get("_id").and_then(|id| id.as_str()).unwrap_or(""),
        ),
        None => ("Imported Insomnia Collection".to_string(), None, ""),
    };

    let mut endpoints = Vec::new();
    let mut folders = Vec::new();
    let mut used_folder_ids = HashSet::new();
    let mut skipped_requests = 0usize;

    collect_v4_items(
        root_id,
        &children,
        &[],
        None,
        &mut endpoints,
        &mut folders,
        &mut used_folder_ids,
        &mut skipped_requests,
    );
    // Resources whose parent is missing from the export (partial exports)
    // bucket under "" — surface them at the collection root rather than
    // dropping them. The workspace itself sits there too but is not a
    // request/request_group, so nothing is visited twice.
    if !root_id.is_empty() {
        collect_v4_items(
            "",
            &children,
            &[],
            None,
            &mut endpoints,
            &mut folders,
            &mut used_folder_ids,
            &mut skipped_requests,
        );
    }

    folders.sort_by(|a, b| a.name.cmp(&b.name));

    // Base environment (child of the workspace) → collection variables;
    // its own children are the selectable sub-environments.
    let mut variables: Vec<VariableEntry> = Vec::new();
    let mut environments: Vec<ImportedEnvironment> = Vec::new();
    for resource in children.get(root_id).cloned().unwrap_or_default() {
        if resource.get("_type").and_then(|t| t.as_str()) != Some("environment") {
            continue;
        }
        variables.extend(
            flatten_environment_data(resource.get("data"))
                .into_iter()
                .map(|(key, value)| VariableEntry { key, value }),
        );

        let base_id = resource.get("_id").and_then(|id| id.as_str()).unwrap_or("");
        for sub in children.get(base_id).cloned().unwrap_or_default() {
            if sub.get("_type").and_then(|t| t.as_str()) != Some("environment") {
                continue;
            }
            environments.push(ImportedEnvironment {
                name: sub
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("Imported Environment")
                    .to_string(),
                variables: flatten_environment_data(sub.get("data"))
                    .into_iter()
                    .map(|(key, value)| (key, Value::String(value)))
                    .collect(),
            });
        }
    }

    let base_url = variables
        .iter()
        .find(|v| v.key.eq_ignore_ascii_case("baseurl") || v.key.eq_ignore_ascii_case("base_url"))
        .map(|v| v.value.clone())
        .or_else(|| derive_base_url(&endpoints));

    Ok(InsomniaImport {
        collection: Collection {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            description,
            base_url,
            endpoints,
            folders,
            variables: Some(variables).filter(|v| !v.is_empty()),
            auth_config: None,
        },
        environments,
        skipped_requests,
    })
}

/// Walk a v4 parent's children recursively, mirroring the Postman importer:
/// nested groups flatten to composite-named folders ("Parent / Child"), the
/// nearest group auth wins, and endpoints land in both the folder and the flat
/// list.
#[allow(clippy::too_many_arguments)]
fn collect_v4_items(
    parent_id: &str,
    children: &HashMap<&str, Vec<&Value>>,
    name_chain: &[String],
    folder_auth: Option<&Value>,
    endpoints: &mut Vec<Endpoint>,
    folders: &mut Vec<Folder>,
    used_folder_ids: &mut HashSet<String>,
    skipped_requests: &mut usize,
) {
    for resource in children.get(parent_id).cloned().unwrap_or_default() {
        match resource.get("_type").and_then(|t| t.as_str()) {
            Some("request_group") => {
                let folder_name = resource
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("Folder")
                    .to_string();
                let mut chain = name_chain.to_vec();
                chain.push(folder_name);

                let own_auth = convert_auth(resource.get("authentication"));
                let child_auth = own_auth.as_ref().or(folder_auth);

                let group_id = resource.get("_id").and_then(|id| id.as_str()).unwrap_or("");
                collect_v4_items(
                    group_id,
                    children,
                    &chain,
                    child_auth,
                    endpoints,
                    folders,
                    used_folder_ids,
                    skipped_requests,
                );
            }
            Some("request") => {
                let endpoint = convert_request(resource);
                place_endpoint(
                    endpoint,
                    name_chain,
                    folder_auth,
                    endpoints,
                    folders,
                    used_folder_ids,
                );
            }
            Some("websocket_request") | Some("grpc_request") => {
                *skipped_requests += 1;
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// v5 (nested collection[] tree)
// ---------------------------------------------------------------------------

fn parse_v5(doc: &Value) -> Result<InsomniaImport, String> {
    let items = doc
        .get("collection")
        .and_then(|c| c.as_array())
        .ok_or("Insomnia v5 export has no collection items")?;

    let name = doc
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Imported Insomnia Collection")
        .to_string();

    let mut endpoints = Vec::new();
    let mut folders = Vec::new();
    let mut used_folder_ids = HashSet::new();
    let mut skipped_requests = 0usize;

    collect_v5_items(
        items,
        &[],
        None,
        &mut endpoints,
        &mut folders,
        &mut used_folder_ids,
        &mut skipped_requests,
    );

    folders.sort_by(|a, b| a.name.cmp(&b.name));

    let mut variables: Vec<VariableEntry> = Vec::new();
    let mut environments: Vec<ImportedEnvironment> = Vec::new();
    if let Some(envs) = doc.get("environments") {
        variables.extend(
            flatten_environment_data(envs.get("data"))
                .into_iter()
                .map(|(key, value)| VariableEntry { key, value }),
        );
        if let Some(subs) = envs.get("subEnvironments").and_then(|s| s.as_array()) {
            for sub in subs {
                environments.push(ImportedEnvironment {
                    name: sub
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("Imported Environment")
                        .to_string(),
                    variables: flatten_environment_data(sub.get("data"))
                        .into_iter()
                        .map(|(key, value)| (key, Value::String(value)))
                        .collect(),
                });
            }
        }
    }

    let base_url = variables
        .iter()
        .find(|v| v.key.eq_ignore_ascii_case("baseurl") || v.key.eq_ignore_ascii_case("base_url"))
        .map(|v| v.value.clone())
        .or_else(|| derive_base_url(&endpoints));

    Ok(InsomniaImport {
        collection: Collection {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            description: None,
            base_url,
            endpoints,
            folders,
            variables: Some(variables).filter(|v| !v.is_empty()),
            auth_config: None,
        },
        environments,
        skipped_requests,
    })
}

fn collect_v5_items(
    items: &[Value],
    name_chain: &[String],
    folder_auth: Option<&Value>,
    endpoints: &mut Vec<Endpoint>,
    folders: &mut Vec<Folder>,
    used_folder_ids: &mut HashSet<String>,
    skipped_requests: &mut usize,
) {
    for item in items {
        if let Some(nested) = item.get("children").and_then(|c| c.as_array()) {
            let folder_name = item
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("Folder")
                .to_string();
            let mut chain = name_chain.to_vec();
            chain.push(folder_name);

            let own_auth = convert_auth(item.get("authentication"));
            let child_auth = own_auth.as_ref().or(folder_auth);

            collect_v5_items(
                nested,
                &chain,
                child_auth,
                endpoints,
                folders,
                used_folder_ids,
                skipped_requests,
            );
        } else if item.get("method").is_some() {
            let endpoint = convert_request(item);
            place_endpoint(
                endpoint,
                name_chain,
                folder_auth,
                endpoints,
                folders,
                used_folder_ids,
            );
        } else if item.get("url").is_some() {
            // A url without an HTTP method is a realtime (WebSocket/gRPC)
            // request; importing it as a GET would misrepresent it.
            *skipped_requests += 1;
        }
    }
}

// ---------------------------------------------------------------------------
// Shared request-level converters
// ---------------------------------------------------------------------------

/// Push an endpoint into the flat list and, when a name chain exists, its
/// composite-named folder (the storage model expects the duplication).
fn place_endpoint(
    endpoint: Endpoint,
    name_chain: &[String],
    folder_auth: Option<&Value>,
    endpoints: &mut Vec<Endpoint>,
    folders: &mut Vec<Folder>,
    used_folder_ids: &mut HashSet<String>,
) {
    if name_chain.is_empty() {
        endpoints.push(endpoint);
        return;
    }
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

fn convert_request(request: &Value) -> Endpoint {
    let name = request
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("Unnamed Request")
        .to_string();
    let method = request
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("GET")
        .to_uppercase();
    let path = string_field(request, "url").unwrap_or_else(|| "/".to_string());
    let (request_body, graphql_data) = match convert_body(request.get("body")) {
        ParsedBody::RequestBody(body) => (Some(body), None),
        ParsedBody::GraphQL(graphql) => (None, Some(graphql)),
        ParsedBody::Empty => (None, None),
    };

    Endpoint {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        method,
        path,
        description: request
            .get("description")
            .and_then(|d| d.as_str())
            .filter(|d| !d.is_empty())
            .map(|s| s.to_string()),
        parameters: convert_parameters(request),
        request_body,
        responses: None,
        security: convert_auth(request.get("authentication")),
        scripts: convert_scripts(request),
        graphql_data,
    }
}

/// `headers[]` and `parameters[]` (both `{name, value, disabled}`) → the
/// grouped parameter maps.
fn convert_parameters(request: &Value) -> Option<Value> {
    let mut query_params = serde_json::Map::new();
    let mut header_params = serde_json::Map::new();

    let fill = |source: Option<&Value>, target: &mut serde_json::Map<String, Value>| {
        if let Some(entries) = source.and_then(|e| e.as_array()) {
            for entry in entries {
                if entry.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
                    continue;
                }
                let Some(name) = entry.get("name").and_then(|n| n.as_str()) else {
                    continue;
                };
                if name.is_empty() {
                    continue;
                }
                let value = entry
                    .get("value")
                    .and_then(|v| v.as_str())
                    .map(rewrite_templates)
                    .unwrap_or_default();
                let desc = entry.get("description").and_then(|d| d.as_str());
                target.insert(name.to_string(), param_map_entry(&value, desc));
            }
        }
    };

    fill(request.get("parameters"), &mut query_params);
    fill(request.get("headers"), &mut header_params);

    if query_params.is_empty() && header_params.is_empty() {
        return None;
    }

    let mut result = serde_json::Map::new();
    if !query_params.is_empty() {
        result.insert("query".to_string(), Value::Object(query_params));
    }
    if !header_params.is_empty() {
        result.insert("header".to_string(), Value::Object(header_params));
    }
    Some(Value::Object(result))
}

fn convert_body(body: Option<&Value>) -> ParsedBody {
    let Some(body_obj) = body.and_then(|b| b.as_object()) else {
        return ParsedBody::Empty;
    };
    let mime = body_obj
        .get("mimeType")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if mime == "application/graphql" {
        return convert_graphql_body(body_obj);
    }

    if mime == "application/x-www-form-urlencoded" || mime.starts_with("multipart/form-data") {
        let body_type = if mime.starts_with("multipart/") {
            "formdata"
        } else {
            "urlencoded"
        };
        let mut fields = serde_json::Map::new();
        if let Some(params) = body_obj.get("params").and_then(|p| p.as_array()) {
            for param in params {
                if param.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
                    continue;
                }
                if param.get("type").and_then(|t| t.as_str()) == Some("file")
                    || param.get("fileName").is_some()
                {
                    continue;
                }
                let Some(name) = param.get("name").and_then(|n| n.as_str()) else {
                    continue;
                };
                let value = param
                    .get("value")
                    .and_then(|v| v.as_str())
                    .map(rewrite_templates)
                    .unwrap_or_default();
                fields.insert(name.to_string(), Value::String(value));
            }
        }
        if fields.is_empty() {
            return ParsedBody::Empty;
        }
        return ParsedBody::RequestBody(serde_json::json!({
            "type": body_type,
            "fields": Value::Object(fields)
        }));
    }

    if mime == "application/octet-stream" {
        return ParsedBody::Empty;
    }

    let text = body_obj.get("text").and_then(|t| t.as_str()).unwrap_or("");
    if text.is_empty() {
        return ParsedBody::Empty;
    }
    ParsedBody::RequestBody(serde_json::json!({ "example": rewrite_templates(text) }))
}

/// Insomnia stores a GraphQL body as `text` holding a JSON string
/// `{"query", "variables", "operationName"}`. Malformed text falls back to a
/// raw body rather than being dropped.
fn convert_graphql_body(body_obj: &serde_json::Map<String, Value>) -> ParsedBody {
    let text = body_obj.get("text").and_then(|t| t.as_str()).unwrap_or("");
    let Ok(payload) = serde_json::from_str::<Value>(text) else {
        if text.is_empty() {
            return ParsedBody::Empty;
        }
        return ParsedBody::RequestBody(serde_json::json!({ "example": rewrite_templates(text) }));
    };

    let query = payload
        .get("query")
        .and_then(|q| q.as_str())
        .map(rewrite_templates)
        .unwrap_or_default();
    let variables = match payload.get("variables") {
        Some(Value::String(s)) => rewrite_templates(s),
        Some(Value::Null) | None => String::new(),
        Some(other) => rewrite_templates(&serde_json::to_string(other).unwrap_or_default()),
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

/// Insomnia oauth2 field → app oauth2 config key (see OAUTH2_KEY_MAP in
/// storage.rs for the Postman equivalent).
const INSOMNIA_OAUTH2_KEY_MAP: [(&str, &str); 8] = [
    ("accessTokenUrl", "tokenUrl"),
    ("authorizationUrl", "authorizationUrl"),
    ("clientId", "clientId"),
    ("clientSecret", "clientSecret"),
    ("scope", "scope"),
    ("redirectUrl", "redirectUri"),
    ("audience", "audience"),
    ("username", "username"),
];

fn convert_auth(auth: Option<&Value>) -> Option<Value> {
    let auth_obj = auth?.as_object()?;
    if auth_obj.get("disabled").and_then(|d| d.as_bool()) == Some(true) {
        return Some(serde_json::json!({ "type": "none", "config": {} }));
    }
    let auth_value = Value::Object(auth_obj.clone());
    let field = |key: &str| string_field(&auth_value, key).unwrap_or_default();

    match auth_obj.get("type").and_then(|t| t.as_str())? {
        "basic" => Some(serde_json::json!({
            "type": "basic",
            "config": { "username": field("username"), "password": field("password") }
        })),
        "bearer" => Some(serde_json::json!({
            "type": "bearer",
            "config": { "token": field("token") }
        })),
        "apikey" => Some(serde_json::json!({
            "type": "api-key",
            "config": {
                "keyName": field("key"),
                "keyValue": field("value"),
                "location": if auth_obj.get("addTo").and_then(|a| a.as_str()) == Some("queryParams") {
                    "query"
                } else {
                    "header"
                }
            }
        })),
        "digest" => Some(serde_json::json!({
            "type": "digest",
            "config": { "username": field("username"), "password": field("password") }
        })),
        "ntlm" => Some(serde_json::json!({
            "type": "ntlm",
            "config": {
                "username": field("username"),
                "password": field("password"),
                "domain": "",
                "workstation": ""
            }
        })),
        "oauth2" => Some(convert_oauth2(&auth_value)),
        "none" => Some(serde_json::json!({ "type": "none", "config": {} })),
        _ => None,
    }
}

fn convert_oauth2(auth: &Value) -> Value {
    let mut config = serde_json::Map::new();

    let grant_type = match auth.get("grantType").and_then(|g| g.as_str()) {
        Some("client_credentials") => "client_credentials",
        Some("password") => "password",
        // The app has no implicit grant; manual token entry is the closest
        // workable configuration.
        Some("implicit") => "manual",
        _ => "authorization_code",
    };
    config.insert(
        "grantType".to_string(),
        Value::String(grant_type.to_string()),
    );

    if let Some(use_pkce) = auth.get("usePkce").and_then(|p| p.as_bool()) {
        config.insert("usePkce".to_string(), Value::Bool(use_pkce));
    }
    if let Some(in_body) = auth.get("credentialsInBody").and_then(|c| c.as_bool()) {
        config.insert(
            "clientAuthMethod".to_string(),
            Value::String(if in_body { "body" } else { "header" }.to_string()),
        );
    }
    for (insomnia_key, app_key) in INSOMNIA_OAUTH2_KEY_MAP {
        if let Some(value) = string_field(auth, insomnia_key).filter(|v| !v.is_empty()) {
            config.insert(app_key.to_string(), Value::String(value));
        }
    }
    if let Some(password) = string_field(auth, "password").filter(|v| !v.is_empty()) {
        config.insert("password".to_string(), Value::String(password));
    }

    serde_json::json!({ "type": "oauth2", "config": Value::Object(config) })
}

/// Request-level scripts. Insomnia's script API is Postman-compatible, so the
/// content imports verbatim under a provenance banner. Both the v4 field names
/// and the v5 `scripts` object are accepted.
fn convert_scripts(request: &Value) -> Option<Value> {
    let pre = request
        .get("preRequestScript")
        .or_else(|| request.pointer("/scripts/preRequest"))
        .and_then(|s| s.as_str())
        .filter(|s| !s.trim().is_empty());
    let after = request
        .get("afterResponseScript")
        .or_else(|| request.pointer("/scripts/afterResponse"))
        .and_then(|s| s.as_str())
        .filter(|s| !s.trim().is_empty());

    if pre.is_none() && after.is_none() {
        return None;
    }

    serde_json::to_value(ScriptData {
        pre_request_script: pre
            .map(|s| format!("// [Imported: Insomnia pre-request script]\n{}", s))
            .unwrap_or_default(),
        test_script: after
            .map(|s| format!("// [Imported: Insomnia after-response script]\n{}", s))
            .unwrap_or_default(),
    })
    .ok()
}

/// Environment `data` objects nest freely; flatten to dotted keys so the
/// rewritten `{{ api.host }}` references resolve, stringifying non-string
/// leaves the way the Postman importer does for variables.
fn flatten_environment_data(data: Option<&Value>) -> Vec<(String, String)> {
    let mut entries = Vec::new();
    let Some(obj) = data.and_then(|d| d.as_object()) else {
        return entries;
    };
    flatten_into("", obj, &mut entries);
    entries
}

fn flatten_into(
    prefix: &str,
    obj: &serde_json::Map<String, Value>,
    out: &mut Vec<(String, String)>,
) {
    for (key, value) in obj {
        let full_key = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{}.{}", prefix, key)
        };
        match value {
            Value::Object(nested) => flatten_into(&full_key, nested, out),
            Value::String(s) => out.push((full_key, rewrite_templates(s))),
            Value::Null => out.push((full_key, String::new())),
            other => out.push((full_key, serde_json::to_string(other).unwrap_or_default())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn v4_fixture() -> Value {
        json!({
            "_type": "export",
            "__export_format": 4,
            "resources": [
                {
                    "_id": "wrk_1", "_type": "workspace", "parentId": null,
                    "name": "Demo API", "description": "An export", "scope": "collection"
                },
                {
                    "_id": "env_base", "_type": "environment", "parentId": "wrk_1",
                    "name": "Base Environment",
                    "data": {
                        "baseUrl": "https://api.example.com",
                        "api": { "host": "api.example.com", "retries": 3 }
                    }
                },
                {
                    "_id": "env_prod", "_type": "environment", "parentId": "env_base",
                    "name": "Production",
                    "data": { "token": "{{ _.baseToken }}" }
                },
                {
                    "_id": "fld_users", "_type": "request_group", "parentId": "wrk_1",
                    "name": "Users", "metaSortKey": 1.0,
                    "authentication": { "type": "bearer", "token": "{{ _.token }}" }
                },
                {
                    "_id": "fld_admin", "_type": "request_group", "parentId": "fld_users",
                    "name": "Admin", "metaSortKey": 1.0
                },
                {
                    "_id": "req_list", "_type": "request", "parentId": "fld_users",
                    "name": "List Users", "method": "get",
                    "url": "{{ _.baseUrl }}/users",
                    "metaSortKey": 1.0,
                    "headers": [
                        { "name": "Accept", "value": "application/json" },
                        { "name": "X-Off", "value": "x", "disabled": true }
                    ],
                    "parameters": [ { "name": "page", "value": "1" } ],
                    "preRequestScript": "console.log('pre');"
                },
                {
                    "_id": "req_del", "_type": "request", "parentId": "fld_admin",
                    "name": "Delete User", "method": "DELETE",
                    "url": "{{ _.baseUrl }}/users/1",
                    "authentication": {
                        "type": "oauth2", "grantType": "authorization_code",
                        "accessTokenUrl": "https://auth.example.com/token",
                        "authorizationUrl": "https://auth.example.com/authorize",
                        "clientId": "client-1", "redirectUrl": "https://app.example.com/cb",
                        "credentialsInBody": true, "usePkce": true
                    }
                },
                {
                    "_id": "req_gql", "_type": "request", "parentId": "wrk_1",
                    "name": "GraphQL", "method": "POST",
                    "url": "{{ _.baseUrl }}/graphql",
                    "body": {
                        "mimeType": "application/graphql",
                        "text": "{\"query\":\"query { users { id } }\",\"variables\":{\"limit\":10}}"
                    }
                },
                {
                    "_id": "req_form", "_type": "request", "parentId": "wrk_1",
                    "name": "Login", "method": "POST",
                    "url": "{{ _.baseUrl }}/login",
                    "authentication": { "type": "basic", "username": "u", "password": "p" },
                    "body": {
                        "mimeType": "application/x-www-form-urlencoded",
                        "params": [
                            { "name": "user", "value": "u" },
                            { "name": "file", "type": "file", "fileName": "a.txt" }
                        ]
                    }
                },
                {
                    "_id": "ws_1", "_type": "websocket_request", "parentId": "wrk_1",
                    "name": "Live", "url": "wss://api.example.com/live"
                },
                {
                    "_id": "req_orphan", "_type": "request", "parentId": "req_gone",
                    "name": "Orphan", "method": "GET", "url": "https://api.example.com/orphan"
                },
                {
                    "_id": "jar_1", "_type": "cookie_jar", "parentId": "wrk_1", "cookies": []
                }
            ]
        })
    }

    fn import_v4() -> InsomniaImport {
        parse_insomnia_export(v4_fixture()).expect("v4 parses")
    }

    fn find_endpoint<'a>(import: &'a InsomniaImport, name: &str) -> &'a Endpoint {
        import
            .collection
            .endpoints
            .iter()
            .find(|e| e.name == name)
            .unwrap_or_else(|| panic!("endpoint {} not found", name))
    }

    #[test]
    fn workspace_groups_and_orphans_build_the_collection() {
        let import = import_v4();
        assert_eq!(import.collection.name, "Demo API");
        assert_eq!(import.collection.description.as_deref(), Some("An export"));
        assert_eq!(import.skipped_requests, 1);

        let folder_names: Vec<&str> = import
            .collection
            .folders
            .iter()
            .map(|f| f.name.as_str())
            .collect();
        assert_eq!(folder_names, vec!["Users", "Users / Admin"]);
        assert_eq!(import.collection.endpoints.len(), 5);
        assert!(import
            .collection
            .endpoints
            .iter()
            .any(|e| e.name == "Orphan"));
    }

    #[test]
    fn templates_are_rewritten_everywhere() {
        let import = import_v4();
        let list = find_endpoint(&import, "List Users");
        assert_eq!(list.path, "{{ baseUrl }}/users");
        assert_eq!(list.method, "GET");

        let users_folder = import
            .collection
            .folders
            .iter()
            .find(|f| f.name == "Users")
            .unwrap();
        assert_eq!(
            users_folder.auth_config.as_ref().unwrap()["config"]["token"],
            "{{ token }}"
        );

        let prod_env = &import.environments[0];
        assert_eq!(prod_env.name, "Production");
        assert_eq!(prod_env.variables["token"], json!("{{ baseToken }}"));
    }

    #[test]
    fn base_environment_flattens_to_collection_variables() {
        let import = import_v4();
        let variables = import.collection.variables.as_ref().unwrap();
        let value = |key: &str| {
            variables
                .iter()
                .find(|v| v.key == key)
                .map(|v| v.value.as_str().to_string())
        };
        assert_eq!(value("baseUrl").as_deref(), Some("https://api.example.com"));
        assert_eq!(value("api.host").as_deref(), Some("api.example.com"));
        assert_eq!(value("api.retries").as_deref(), Some("3"));
        assert_eq!(
            import.collection.base_url.as_deref(),
            Some("https://api.example.com")
        );
    }

    #[test]
    fn disabled_headers_are_skipped_and_params_map() {
        let import = import_v4();
        let list = find_endpoint(&import, "List Users");
        let params = list.parameters.as_ref().unwrap();
        assert!(params.pointer("/header/Accept").is_some());
        assert!(params.pointer("/header/X-Off").is_none());
        assert_eq!(params.pointer("/query/page/example").unwrap(), &json!("1"));

        let scripts: ScriptData = serde_json::from_value(list.scripts.clone().unwrap()).unwrap();
        assert!(scripts.pre_request_script.contains("console.log('pre');"));
        assert!(scripts
            .pre_request_script
            .contains("[Imported: Insomnia pre-request script]"));
    }

    #[test]
    fn oauth2_maps_to_app_config() {
        let import = import_v4();
        let del = find_endpoint(&import, "Delete User");
        let security = del.security.as_ref().unwrap();
        assert_eq!(security["type"], "oauth2");
        let config = &security["config"];
        assert_eq!(config["grantType"], "authorization_code");
        assert_eq!(config["usePkce"], true);
        assert_eq!(config["tokenUrl"], "https://auth.example.com/token");
        assert_eq!(config["redirectUri"], "https://app.example.com/cb");
        assert_eq!(config["clientAuthMethod"], "body");
    }

    #[test]
    fn graphql_and_form_bodies_map() {
        let import = import_v4();
        let gql = find_endpoint(&import, "GraphQL");
        assert!(gql.request_body.is_none());
        let graphql = gql.graphql_data.as_ref().unwrap();
        assert_eq!(graphql["mode"], "graphql");
        assert_eq!(graphql["query"], "query { users { id } }");
        assert_eq!(graphql["variables"], "{\"limit\":10}");

        let login = find_endpoint(&import, "Login");
        let body = login.request_body.as_ref().unwrap();
        assert_eq!(body["type"], "urlencoded");
        assert_eq!(body["fields"]["user"], "u");
        assert!(body["fields"].get("file").is_none());
        assert_eq!(login.security.as_ref().unwrap()["type"], "basic");
    }

    #[test]
    fn a_v5_collection_parses_through_the_same_converters() {
        let doc = json!({
            "type": "collection.insomnia.rest/5.0",
            "name": "V5 Demo",
            "collection": [
                {
                    "name": "Things",
                    "children": [
                        {
                            "name": "List Things",
                            "method": "GET",
                            "url": "{{ _.baseUrl }}/things",
                            "headers": [ { "name": "Accept", "value": "application/json" } ],
                            "scripts": { "afterResponse": "console.log('after');" }
                        }
                    ]
                },
                {
                    "name": "Ping",
                    "method": "GET",
                    "url": "https://api.example.com/ping"
                }
            ],
            "environments": {
                "name": "Base Environment",
                "data": { "baseUrl": "https://api.example.com" },
                "subEnvironments": [
                    { "name": "Staging", "data": { "baseUrl": "https://staging.example.com" } }
                ]
            }
        });

        let import = parse_insomnia_export(doc).expect("v5 parses");
        assert_eq!(import.collection.name, "V5 Demo");
        assert_eq!(import.collection.folders.len(), 1);
        assert_eq!(import.collection.endpoints.len(), 2);

        let list = find_endpoint(&import, "List Things");
        assert_eq!(list.path, "{{ baseUrl }}/things");
        let scripts: ScriptData = serde_json::from_value(list.scripts.clone().unwrap()).unwrap();
        assert!(scripts.test_script.contains("console.log('after');"));

        assert_eq!(import.environments.len(), 1);
        assert_eq!(import.environments[0].name, "Staging");
    }

    #[test]
    fn unrecognized_documents_error_specifically() {
        assert!(parse_insomnia_export(json!({ "foo": 1 }))
            .unwrap_err()
            .contains("Not a recognized Insomnia export"));
        assert!(
            parse_insomnia_export(json!({ "type": "environment.insomnia.rest/5.0" }))
                .unwrap_err()
                .contains("environment export")
        );
    }
}
