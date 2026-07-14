//! Collection import/export Tauri commands (OpenAPI & Postman) and shared models.
//!
//! Parsing/serialization logic lives in the submodules; the command entry points
//! stay here so their registration paths in `main.rs` remain stable.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

mod export;
mod openapi;
mod postman;
mod storage;

use export::{collection_to_openapi, collection_to_postman, load_collection_for_export};
use openapi::parse_openapi_spec;
use postman::parse_postman_collection;
use storage::{
    get_last_import_directory, pick_import_file_with_kind, save_collection_to_files,
    save_last_import_directory,
};

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
    pub variables: Option<Vec<VariableEntry>>,
}

/// A single collection variable; kept as an ordered list (matching the
/// `variables.json` array shape) so Postman variable order survives round trips.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableEntry {
    pub key: String,
    pub value: String,
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
    /// Authentication configuration: { type: "bearer"|"basic"|"api-key"|"digest"|"oauth2", config: {...} }
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<Value>,
    /// Transient per-request scripts ({ preRequestScript, testScript }); persisted
    /// to the endpoint's data file, never serialized into collection.json.
    #[serde(skip_serializing, default)]
    pub scripts: Option<Value>,
    /// Transient GraphQL body ({ mode: "graphql", query, variables }); persisted
    /// to the endpoint's data file, never serialized into collection.json.
    #[serde(skip_serializing, default)]
    pub graphql_data: Option<Value>,
}

#[tauri::command]
pub async fn import_openapi_file(
    app: AppHandle,
    file_path: Option<String>,
    storage_parent_path: Option<String>,
) -> Result<Option<Collection>, String> {
    let resolved_file_path = if let Some(file_path) = file_path {
        let path = PathBuf::from(file_path);
        save_last_import_directory(&app, &path);
        path
    } else {
        let Some(path) = pick_import_file_with_kind(&app, "openapi").await? else {
            return Ok(None);
        };
        path
    };
    let content = std::fs::read_to_string(&resolved_file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Parse as YAML (also handles JSON)
    let spec: Value = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse OpenAPI spec: {}", e))?;

    // Convert OpenAPI spec to Collection
    let collection = parse_openapi_spec(spec)?;

    // Save to file-based storage
    save_collection_to_files(&app, &collection, storage_parent_path)?;

    Ok(Some(collection))
}

#[tauri::command]
pub async fn import_postman_collection(
    app: AppHandle,
    file_path: Option<String>,
    storage_parent_path: Option<String>,
) -> Result<Option<Collection>, String> {
    let resolved_file_path = if let Some(file_path) = file_path {
        let path = PathBuf::from(file_path);
        save_last_import_directory(&app, &path);
        path
    } else {
        let Some(path) = pick_import_file_with_kind(&app, "postman").await? else {
            return Ok(None);
        };
        path
    };

    let content = std::fs::read_to_string(&resolved_file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let postman: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Postman collection: {}", e))?;

    // Convert Postman format to Collection
    let collection = parse_postman_collection(postman)?;

    // Save to file-based storage
    save_collection_to_files(&app, &collection, storage_parent_path)?;

    Ok(Some(collection))
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
pub async fn collections_pick_import_file(
    app: AppHandle,
    import_kind: String,
) -> Result<Option<String>, String> {
    Ok(pick_import_file_with_kind(&app, &import_kind)
        .await?
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn export_openapi(
    app: AppHandle,
    collection_id: String,
    format: String,
) -> Result<Value, String> {
    let collection = load_collection_for_export(&app, &collection_id)?;

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
    let (openapi_spec, skipped) = collection_to_openapi(&collection);

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
    let collection = load_collection_for_export(&app, &collection_id)?;

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

    let (postman_collection, skipped) = collection_to_postman(&collection);
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

#[tauri::command]
pub async fn save_json_export(
    app: AppHandle,
    default_file_name: String,
    content: String,
) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(default_file_name)
        .add_filter("JSON Files", &["json"]);

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

    let file_path = path.as_path().ok_or("Invalid file path")?;

    save_last_import_directory(&app, file_path);

    std::fs::write(file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy()
    }))
}

#[tauri::command]
pub async fn save_documentation(
    app: AppHandle,
    default_file_name: String,
    content: String,
    mime_type: String,
) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    // Determine file extension and filter based on mime type
    let (filter_name, extensions): (&str, &[&str]) = match mime_type.as_str() {
        "text/html" => ("HTML Files", &["html"]),
        "text/markdown" => ("Markdown Files", &["md"]),
        _ => ("All Files", &["*"]),
    };

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(default_file_name)
        .add_filter(filter_name, extensions);

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

    let file_path = path.as_path().ok_or("Invalid file path")?;

    save_last_import_directory(&app, file_path);

    std::fs::write(file_path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy()
    }))
}
