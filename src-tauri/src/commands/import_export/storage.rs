//! File-system persistence and import-dialog helpers shared by import and export.
//!
//! `is_http_method` also lives here as a shared predicate.

use super::{Collection, VariableEntry};
use crate::commands::collections as storage_collections;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;

const STORE_FILE: &str = "resonance-store.json";
const LAST_IMPORT_DIR_KEY: &str = "lastImportDirectory";
const COLLECTIONS_DIR: &str = "collections";

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

/// Get the collections directory path
fn get_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join(COLLECTIONS_DIR))
}

/// Ensure the collections directory exists
fn ensure_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_collections_dir(app)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create collections dir: {}", e))?;
    }
    Ok(dir)
}

/// Write JSON to file with pretty printing
fn write_json_file<T: Serialize>(path: &PathBuf, data: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Save a collection to the file-based storage format
pub(crate) fn save_collection_to_files(
    app: &AppHandle,
    collection: &Collection,
    storage_parent_path: Option<String>,
) -> Result<(), String> {
    ensure_collections_dir(app)?;

    let endpoints = serde_json::to_value(&collection.endpoints)
        .map_err(|e| format!("Failed to serialize endpoints: {}", e))?;
    let folders = serde_json::to_value(&collection.folders)
        .map_err(|e| format!("Failed to serialize folders: {}", e))?;

    let persisted = storage_collections::persist_collection(
        app,
        storage_collections::Collection {
            id: collection.id.clone(),
            name: collection.name.clone(),
            base_url: collection.base_url.clone().unwrap_or_default(),
            endpoints: endpoints.as_array().cloned().unwrap_or_default(),
            folders: folders.as_array().cloned().unwrap_or_default(),
            default_headers: serde_json::json!({}),
            open_api_spec: None,
            storage_path: None,
            storage_parent_path,
        },
    )?;

    let collection_dir = PathBuf::from(
        persisted
            .storage_path
            .ok_or_else(|| "Collection storage path missing".to_string())?,
    );

    save_collection_variables(collection, &collection_dir)?;
    save_endpoint_data_files(collection, &collection_dir)?;

    Ok(())
}

/// Write the imported collection variables to variables.json. Falls back to a
/// lone baseUrl entry (the pre-existing behavior) for importers that don't
/// produce a variable list, e.g. OpenAPI.
fn save_collection_variables(
    collection: &Collection,
    collection_dir: &std::path::Path,
) -> Result<(), String> {
    let mut variables = collection.variables.clone().unwrap_or_default();

    if variables.is_empty() {
        if let Some(base_url) = collection.base_url.as_ref().filter(|s| !s.is_empty()) {
            variables.push(VariableEntry {
                key: "baseUrl".to_string(),
                value: base_url.clone(),
            });
        }
    }

    if !variables.is_empty() {
        let variables_file = collection_dir.join("variables.json");
        write_json_file(&variables_file, &variables)?;
    }

    Ok(())
}

/// Persist imported per-endpoint payloads (scripts, GraphQL bodies) into the
/// endpoint data files the app reads them from. Endpoints appear in both the
/// flat list and their folder, so writes are deduped by id.
fn save_endpoint_data_files(
    collection: &Collection,
    collection_dir: &std::path::Path,
) -> Result<(), String> {
    let requests_dir = collection_dir.join("requests");
    let mut written: std::collections::HashSet<&str> = std::collections::HashSet::new();

    for endpoint in &collection.endpoints {
        if endpoint.scripts.is_none() && endpoint.graphql_data.is_none() {
            continue;
        }
        if !written.insert(endpoint.id.as_str()) {
            continue;
        }

        if !requests_dir.exists() {
            fs::create_dir_all(&requests_dir)
                .map_err(|e| format!("Failed to create requests dir: {}", e))?;
        }

        let data = storage_collections::EndpointData {
            scripts: endpoint.scripts.clone(),
            graphql_data: endpoint.graphql_data.clone(),
            ..Default::default()
        };
        let file_name =
            storage_collections::desired_endpoint_file_name(&endpoint.name, &endpoint.id);
        write_json_file(&requests_dir.join(file_name), &data)?;
    }

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
