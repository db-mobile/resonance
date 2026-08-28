//! Collection import/export Tauri commands (OpenAPI & Postman) and shared models.
//!
//! Parsing/serialization logic lives in the submodules; the command entry points
//! stay here so their registration paths in `main.rs` remain stable.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    /// Collection-level auth ({ type, config }) inherited by endpoints whose
    /// auth type is "inherit"; same shape as `Endpoint::security`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_config: Option<Value>,
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
    /// Folder-level auth ({ type, config }); overrides the collection auth for
    /// endpoints in this folder whose own auth type is "inherit".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_config: Option<Value>,
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
    /// Authentication configuration: { type: "bearer"|"basic"|"api-key"|"digest"|"ntlm"|"oauth2", config: {...} }
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
    let spec: Value = serde_yaml_ng::from_str(&content)
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
    let Some(file_path) = pick_import_file_with_kind(&app, "postman_environment").await? else {
        return Ok(None);
    };

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

/// The payload every export command returns when the user dismisses the save
/// dialog. Distinct from an error: cancelling is a normal outcome.
fn cancelled_export() -> Value {
    serde_json::json!({ "success": false, "cancelled": true })
}

/// Run a save dialog seeded with the last used directory, returning `None` when
/// the user cancels.
///
/// Callers do their own work *after* this resolves, so a cancelled dialog never
/// pays for serializing an export that is about to be thrown away.
async fn pick_save_path(
    app: &AppHandle,
    default_file_name: String,
    filter_name: &str,
    extensions: &[&str],
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(default_file_name)
        .add_filter(filter_name, extensions);

    if let Some(last_dir) = get_last_import_directory(app) {
        dialog = dialog.set_directory(last_dir);
    }

    dialog.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let Some(path) = rx.await.map_err(|e| format!("Dialog error: {}", e))? else {
        return Ok(None);
    };

    let path = path.as_path().ok_or("Invalid file path")?.to_path_buf();
    Ok(Some(path))
}

/// Write an export and remember its directory for the next dialog. Returns the
/// path as the frontend reports it.
fn write_export(app: &AppHandle, path: &Path, content: &str) -> Result<String, String> {
    save_last_import_directory(app, path);
    std::fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn export_openapi(
    app: AppHandle,
    collection_id: String,
    format: String,
) -> Result<Value, String> {
    let collection = load_collection_for_export(&app, &collection_id)?;

    let is_yaml = format == "yaml";
    let file_ext = if is_yaml { "yaml" } else { "json" };
    let filter_name = if is_yaml { "YAML Files" } else { "JSON Files" };

    let Some(path) = pick_save_path(
        &app,
        format!("{}.openapi.{}", collection.name, file_ext),
        filter_name,
        &[file_ext],
    )
    .await?
    else {
        return Ok(cancelled_export());
    };

    let (openapi_spec, skipped) = collection_to_openapi(&collection);
    let content = if is_yaml {
        serde_yaml_ng::to_string(&openapi_spec).map_err(|e| e.to_string())?
    } else {
        serde_json::to_string_pretty(&openapi_spec).map_err(|e| e.to_string())?
    };

    let file_path = write_export(&app, &path, &content)?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path,
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

    let Some(path) = pick_save_path(
        &app,
        format!("{}.postman_collection.json", collection.name),
        "Postman Collection",
        &["json"],
    )
    .await?
    else {
        return Ok(cancelled_export());
    };

    let (postman_collection, skipped) = collection_to_postman(&collection);
    let content = serde_json::to_string_pretty(&postman_collection).map_err(|e| e.to_string())?;

    let file_path = write_export(&app, &path, &content)?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path,
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
    let Some(path) = pick_save_path(&app, default_file_name, "JSON Files", &["json"]).await? else {
        return Ok(cancelled_export());
    };

    let file_path = write_export(&app, &path, &content)?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path
    }))
}

#[tauri::command]
pub async fn save_documentation(
    app: AppHandle,
    default_file_name: String,
    content: String,
    mime_type: String,
) -> Result<Value, String> {
    let (filter_name, extensions): (&str, &[&str]) = match mime_type.as_str() {
        "text/html" => ("HTML Files", &["html"]),
        "text/markdown" => ("Markdown Files", &["md"]),
        _ => ("All Files", &["*"]),
    };

    let Some(path) = pick_save_path(&app, default_file_name, filter_name, extensions).await? else {
        return Ok(cancelled_export());
    };

    let file_path = write_export(&app, &path, &content)?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path
    }))
}
