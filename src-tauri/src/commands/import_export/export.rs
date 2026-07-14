//! Serialization of a stored `Collection` into OpenAPI and Postman formats,
//! plus loading a collection from disk for export.

use super::storage::is_http_method;
use super::{Collection, Endpoint, Folder, VariableEntry};
use crate::commands::collections as storage_collections;
use crate::commands::scripts::ScriptData;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

pub(crate) fn load_collection_for_export(
    app: &AppHandle,
    collection_id: &str,
) -> Result<Collection, String> {
    let collection_dir = storage_collections::resolve_collection_dir(app, collection_id)?
        .ok_or_else(|| format!("Collection {} not found", collection_id))?;

    let collection_file = collection_dir.join("collection.json");
    let content = fs::read_to_string(&collection_file)
        .map_err(|e| format!("Failed to read collection.json: {}", e))?;
    let raw: Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse collection: {}", e))?;

    let id = raw
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or(collection_id)
        .to_string();
    let name = raw
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let description = raw
        .get("description")
        .and_then(|v| v.as_str())
        .map(String::from);
    let base_url = raw
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let mut endpoints: Vec<Endpoint> = raw
        .get("endpoints")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let mut folders: Vec<Folder> = raw
        .get("folders")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let variables_file = collection_dir.join("variables.json");
    let variables: Option<Vec<VariableEntry>> = if variables_file.exists() {
        fs::read_to_string(&variables_file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
            .map(|entries| {
                entries
                    .into_iter()
                    .filter_map(|e| {
                        let key = e.get("key")?.as_str()?.to_string();
                        let value = e
                            .get("value")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        Some(VariableEntry { key, value })
                    })
                    .collect()
            })
    } else {
        None
    };

    attach_endpoint_data(
        &collection_dir.join("requests"),
        &mut endpoints,
        &mut folders,
    );

    Ok(Collection {
        id,
        name,
        description,
        base_url,
        endpoints,
        folders,
        variables,
    })
}

/// Cached per-endpoint payload: (scripts, graphql_data), None when no data file exists.
type EndpointPayload = Option<(Option<Value>, Option<Value>)>;

/// Populate the transient `scripts`/`graphql_data` fields from each endpoint's
/// data file so they can be serialized on export. Data is read once per
/// endpoint id and applied to both the flat and folder occurrences.
fn attach_endpoint_data(requests_dir: &Path, endpoints: &mut [Endpoint], folders: &mut [Folder]) {
    let mut cache: HashMap<String, EndpointPayload> = HashMap::new();

    let mut fill = |endpoint: &mut Endpoint| {
        let data = cache.entry(endpoint.id.clone()).or_insert_with(|| {
            storage_collections::find_endpoint_data_file(requests_dir, &endpoint.id)
                .ok()
                .flatten()
                .and_then(|path| fs::read_to_string(path).ok())
                .and_then(|s| serde_json::from_str::<storage_collections::EndpointData>(&s).ok())
                .map(|d| (d.scripts, d.graphql_data))
        });
        if let Some((scripts, graphql_data)) = data {
            endpoint.scripts = scripts.clone();
            endpoint.graphql_data = graphql_data.clone();
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

pub(crate) fn collection_to_openapi(collection: &Collection) -> (Value, Vec<String>) {
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

    let graphql_body = endpoint
        .graphql_data
        .as_ref()
        .filter(|g| g.get("mode").and_then(|m| m.as_str()) == Some("graphql"));
    if let Some(graphql) = graphql_body {
        request["body"] = serde_json::json!({
            "mode": "graphql",
            "graphql": {
                "query": graphql.get("query").and_then(|q| q.as_str()).unwrap_or(""),
                "variables": graphql.get("variables").and_then(|v| v.as_str()).unwrap_or("")
            }
        });
    } else if let Some(body) = &endpoint.request_body {
        if let Some(example) = body.get("example").and_then(|v| v.as_str()) {
            request["body"] = serde_json::json!({
                "mode": "raw",
                "raw": example
            });
        }
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
    let security = endpoint.security.as_ref()?;
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
            let token = get("token")?;
            Some(serde_json::json!({
                "type": "bearer",
                "bearer": [{ "key": "token", "value": token, "type": "string" }]
            }))
        }
        "basic" => Some(serde_json::json!({
            "type": "basic",
            "basic": [
                { "key": "username", "value": get("username").unwrap_or(""), "type": "string" },
                { "key": "password", "value": get("password").unwrap_or(""), "type": "string" }
            ]
        })),
        "digest" => Some(serde_json::json!({
            "type": "digest",
            "digest": [
                { "key": "username", "value": get("username").unwrap_or(""), "type": "string" },
                { "key": "password", "value": get("password").unwrap_or(""), "type": "string" }
            ]
        })),
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
    let mappings = [
        ("tokenUrl", "accessTokenUrl"),
        ("authorizationUrl", "authUrl"),
        ("clientId", "clientId"),
        ("clientSecret", "clientSecret"),
        ("scope", "scope"),
        ("redirectUri", "redirect_uri"),
        ("username", "username"),
        ("password", "password"),
        ("audience", "audience"),
        ("clientAuthMethod", "client_authentication"),
        ("headerPrefix", "headerPrefix"),
        ("token", "accessToken"),
    ];
    for (app_key, postman_key) in mappings {
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
fn insert_into_item_tree(items: &mut Vec<Value>, segments: &[&str], folder_items: Vec<Value>) {
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

    let children = node
        .get_mut("item")
        .and_then(|i| i.as_array_mut())
        .expect("folder node has an item array");
    insert_into_item_tree(children, rest, folder_items);
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
            insert_into_item_tree(&mut items, &segments, folder_items);
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
    if !has_base_url_variable {
        if let Some(base_url) = collection.base_url.as_ref().filter(|s| !s.is_empty()) {
            variables.push(serde_json::json!({
                "key": "baseUrl",
                "value": base_url,
                "type": "string"
            }));
        }
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
            parameters: None,
            request_body: None,
            responses: None,
            security: None,
            scripts: None,
            graphql_data: None,
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
            }],
            variables: Some(vec![VariableEntry {
                key: "apiKey".to_string(),
                value: "secret".to_string(),
            }]),
        };

        let (postman, skipped) = collection_to_postman(&collection);
        assert!(skipped.is_empty());

        let items = postman["item"].as_array().unwrap();
        assert_eq!(items.len(), 3);

        let parent = items.iter().find(|i| i["name"] == "Parent").unwrap();
        let child = &parent["item"][0];
        assert_eq!(child["name"], "Child");
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
        assert!(apikey
            .iter()
            .any(|p| p["key"] == "key" && p["value"] == "X-Api-Key"));
        assert!(apikey
            .iter()
            .any(|p| p["key"] == "value" && p["value"] == "abc"));

        let variables = postman["variable"].as_array().unwrap();
        assert_eq!(variables[0]["key"], "apiKey");
        assert_eq!(variables[1]["key"], "baseUrl");
        assert_eq!(variables[1]["value"], "https://api.example.com");
    }

    #[test]
    fn postman_import_export_round_trips() {
        let fixture = serde_json::json!({
            "info": { "name": "RoundTrip" },
            "variable": [
                { "key": "baseUrl", "value": "https://api.example.com" },
                { "key": "token", "value": "abc" }
            ],
            "item": [
                {
                    "name": "Users",
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
        let (exported, skipped) = collection_to_postman(&imported);
        assert!(skipped.is_empty());
        let reimported = parse_postman_collection(exported).unwrap();

        assert_eq!(reimported.folders.len(), 1);
        assert_eq!(reimported.folders[0].name, "Users / Admin");

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
}
