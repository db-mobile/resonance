//! Serialization of a stored `Collection` into OpenAPI and Postman formats,
//! plus loading a collection from disk for export.

use super::storage::is_http_method;
use super::{Collection, Endpoint, Folder};
use crate::commands::collections as storage_collections;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
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

    let endpoints: Vec<Endpoint> = raw
        .get("endpoints")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let folders: Vec<Folder> = raw
        .get("folders")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    let variables_file = collection_dir.join("variables.json");
    let variables: Option<HashMap<String, String>> = if variables_file.exists() {
        fs::read_to_string(&variables_file)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
            .map(|entries| {
                entries
                    .into_iter()
                    .filter_map(|e| {
                        let key = e.get("key")?.as_str()?.to_string();
                        let value = e.get("value")?.as_str()?.to_string();
                        Some((key, value))
                    })
                    .collect()
            })
    } else {
        None
    };

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
