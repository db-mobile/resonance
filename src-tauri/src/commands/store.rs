use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use super::fs_secure::restrict_file;
use super::store_files::{store_file_for, ALL_STORES};

/// Best-effort restriction of one on-disk store file to owner-only access.
/// The store plugin writes it with the process umask (typically world-readable),
/// so it holds request history, the cookie jar, and any plaintext-fallback
/// secrets — tighten it after every save.
pub(crate) fn restrict_store_file_named(app: &AppHandle, file: &str) {
    if let Ok(dir) = app.path().app_data_dir() {
        restrict_file(&dir.join(file));
    }
}

/// Tightens every store file the app owns, for startup and for callers that
/// wrote through a path that does not know which file it touched.
pub(crate) fn restrict_store_file(app: &AppHandle) {
    for file in ALL_STORES {
        restrict_store_file_named(app, file);
    }
}

fn get_default_for_key(key: &str) -> Value {
    match key {
        "collections" => serde_json::json!([]),
        "environments" => serde_json::json!([]),
        "activeEnvironmentId" => Value::Null,
        "requestHistory" => serde_json::json!([]),
        "cookieJar" => serde_json::json!([]),
        // These four are the keys the frontend actually uses; the store once
        // named them workspaceTabs/activeWorkspaceTabId/accentColor/
        // mockServerSettings, which never matched and so never applied.
        "workspace-tabs" => serde_json::json!([]),
        "active-tab-id" => Value::Null,
        "theme" => serde_json::json!("system"),
        "accent" => serde_json::json!("blue"),
        "proxySettings" => {
            serde_json::to_value(super::proxy::ProxySettings::default()).unwrap_or(Value::Null)
        }
        "mockServer" => serde_json::json!({
            "port": 3001,
            "delay": 0,
            "enabled": false
        }),
        "clientCertificates" => serde_json::json!({ "items": [] }),
        "secretValues" => serde_json::json!({}),
        "secretIndex" => serde_json::json!({}),
        "settings" => serde_json::json!({
            "httpVersion": "auto",
            "timeout": 30000,
            "theme": "system",
            "accentColor": "blue",
            "language": "en"
        }),
        _ if key.ends_with("Scripts") => serde_json::json!({}),
        _ if key.ends_with("Variables") => serde_json::json!([]),
        _ => Value::Null,
    }
}

#[tauri::command]
pub async fn store_get(app: AppHandle, key: String) -> Result<Value, String> {
    let store = app.store(store_file_for(&key)).map_err(|e| e.to_string())?;

    let value = store.get(&key).unwrap_or(Value::Null);

    if value.is_null() {
        Ok(get_default_for_key(&key))
    } else {
        Ok(value)
    }
}

#[tauri::command]
pub async fn store_set(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let file = store_file_for(&key);
    let store = app.store(file).map_err(|e| e.to_string())?;

    store.set(key, value);
    store.save().map_err(|e| e.to_string())?;
    restrict_store_file_named(&app, file);

    Ok(())
}

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<Value, String> {
    let result = store_get(app, "settings".to_string()).await?;

    if result.is_null() {
        Ok(serde_json::json!({
            "httpVersion": "auto",
            "timeout": 30000,
            "theme": "system",
            "accentColor": "blue",
            "language": "en"
        }))
    } else {
        Ok(result)
    }
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, settings: Value) -> Result<(), String> {
    store_set(app, "settings".to_string(), settings).await
}
