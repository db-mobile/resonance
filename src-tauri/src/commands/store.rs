use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "resonance-store.json";

fn get_default_for_key(key: &str) -> Value {
    match key {
        "collections" => serde_json::json!([]),
        "environments" => serde_json::json!([]),
        "activeEnvironmentId" => Value::Null,
        "requestHistory" => serde_json::json!([]),
        "workspaceTabs" => serde_json::json!([]),
        "activeWorkspaceTabId" => Value::Null,
        "theme" => serde_json::json!("dark"),
        "accentColor" => serde_json::json!("blue"),
        "proxySettings" => serde_json::json!({
            "enabled": false,
            "mode": "manual",
            "manualConfig": {
                "httpProxy": "",
                "httpsProxy": "",
                "noProxy": ""
            }
        }),
        "mockServerSettings" => serde_json::json!({
            "port": 3001,
            "delay": 0,
            "enabled": false
        }),
        "settings" => serde_json::json!({
            "httpVersion": "auto",
            "timeout": 30000,
            "theme": "dark",
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
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;

    let value = store.get(&key).unwrap_or(Value::Null);

    if value.is_null() {
        Ok(get_default_for_key(&key))
    } else {
        Ok(value)
    }
}

#[tauri::command]
pub async fn store_set(app: AppHandle, key: String, value: Value) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;

    store.set(key, value);
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<Value, String> {
    let result = store_get(app, "settings".to_string()).await?;

    if result.is_null() {
        Ok(serde_json::json!({
            "httpVersion": "auto",
            "timeout": 30000,
            "theme": "dark",
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

#[allow(dead_code)]
#[tauri::command]
pub async fn migrate_electron_store(app: AppHandle, electron_data: Value) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;

    if let Value::Object(map) = electron_data {
        for (key, value) in map {
            store.set(key, value);
        }
    }

    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
