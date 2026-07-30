//! File-system persistence and import-dialog helpers shared by import and export.
//!
//! `is_http_method` also lives here as a shared predicate.

use super::{Collection, VariableEntry};
use crate::commands::collections as storage_collections;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;

const STORE_FILE: &str = "resonance-store.json";
const LAST_IMPORT_DIR_KEY: &str = "lastImportDirectory";

/// Postman OAuth2 parameter names paired with the app's config keys, as
/// `(postman_key, app_key)`. Import reads it left to right and export right to
/// left; one table keeps the two directions from drifting apart.
pub(crate) const OAUTH2_KEY_MAP: [(&str, &str); 12] = [
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

pub(crate) fn is_http_method(method: &str) -> bool {
    matches!(
        method.to_ascii_uppercase().as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
    )
}

/// Get the last used import directory from the store
pub(crate) fn get_last_import_directory(app: &AppHandle) -> Option<std::path::PathBuf> {
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
pub(crate) fn save_last_import_directory(app: &AppHandle, file_path: &std::path::Path) {
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

/// Save a collection to the file-based storage format
pub(crate) fn save_collection_to_files(
    app: &AppHandle,
    collection: &Collection,
    storage_parent_path: Option<String>,
) -> Result<(), String> {
    let endpoints = serde_json::to_value(&collection.endpoints)
        .map_err(|e| format!("Failed to serialize endpoints: {}", e))?;
    let folders = serde_json::to_value(&collection.folders)
        .map_err(|e| format!("Failed to serialize folders: {}", e))?;

    let mut variables = collection.variables.clone().unwrap_or_default();
    if variables.is_empty() {
        if let Some(base_url) = collection.base_url.as_ref().filter(|s| !s.is_empty()) {
            variables.push(VariableEntry {
                key: "baseUrl".to_string(),
                value: base_url.clone(),
            });
        }
    }
    let variables = variables
        .iter()
        .map(|entry| serde_json::to_value(entry).unwrap_or(serde_json::Value::Null))
        .filter(|v| !v.is_null())
        .collect::<Vec<_>>();

    let mut endpoint_data = std::collections::HashMap::new();
    for endpoint in &collection.endpoints {
        if endpoint.scripts.is_none() && endpoint.graphql_data.is_none() {
            continue;
        }
        endpoint_data.entry(endpoint.id.clone()).or_insert_with(|| {
            storage_collections::EndpointData {
                scripts: endpoint.scripts.clone(),
                graphql_data: endpoint.graphql_data.clone(),
                ..Default::default()
            }
        });
    }

    storage_collections::persist_imported_collection(
        app,
        storage_collections::Collection {
            id: collection.id.clone(),
            name: collection.name.clone(),
            base_url: collection.base_url.clone().unwrap_or_default(),
            endpoints: endpoints.as_array().cloned().unwrap_or_default(),
            folders: folders.as_array().cloned().unwrap_or_default(),
            default_headers: serde_json::json!({}),
            auth_config: collection.auth_config.clone(),
            open_api_spec: None,
            storage_path: None,
            storage_parent_path,
            linked: false,
        },
        variables,
        endpoint_data,
    )?;

    Ok(())
}

pub(crate) async fn pick_import_file_with_kind(
    app: &AppHandle,
    import_kind: &str,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app.dialog().file();
    match import_kind {
        "openapi" => {
            dialog = dialog.add_filter("OpenAPI Files", &["yml", "yaml", "json"]);
        }
        "postman" => {
            dialog = dialog.add_filter("Postman Collection", &["json"]);
        }
        "postman_environment" => {
            dialog = dialog.add_filter("Postman Environment", &["json"]);
        }
        _ => {}
    }

    if let Some(last_dir) = get_last_import_directory(app) {
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
    save_last_import_directory(app, file_path);
    Ok(Some(file_path.to_path_buf()))
}
