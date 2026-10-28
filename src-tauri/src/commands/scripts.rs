use super::store_files::MAIN_STORE as STORE_FILE;
pub use resonance_core::scripts::*;
use serde_json::Value;
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
const SCRIPTS_KEY: &str = "persistedScripts";

fn scripts_are_empty(scripts: &ScriptData) -> bool {
    scripts.pre_request_script.is_empty() && scripts.test_script.is_empty()
}

/// Read a one-off script entry from the legacy global store.
fn read_legacy_store_script(app: &AppHandle, key: &str) -> Option<ScriptData> {
    read_legacy_store_scripts(app).get(key).cloned()
}

/// Read once for a batch capture, without migrating or rewriting script data.
pub(crate) fn read_legacy_store_scripts(app: &AppHandle) -> HashMap<String, ScriptData> {
    let Ok(store) = app.store(STORE_FILE) else {
        return HashMap::new();
    };
    store
        .get(SCRIPTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Remove a single `"{collectionId}_{endpointId}"` entry from the legacy global
/// store. Best-effort: errors are swallowed because the authoritative copy
/// already lives in the per-endpoint file.
fn remove_store_script_entry(app: &AppHandle, collection_id: &str, endpoint_id: &str) {
    let Ok(store) = app.store(STORE_FILE) else {
        return;
    };
    let mut map: HashMap<String, Value> = store
        .get(SCRIPTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let key = format!("{}_{}", collection_id, endpoint_id);
    if map.remove(&key).is_some() {
        store.set(SCRIPTS_KEY.to_string(), serde_json::to_value(map).unwrap());
        let _ = store.save();
    }
}

/// Drop every script entry keyed by the given collection from the legacy store.
/// Called by `collection_delete` to keep the store from accumulating orphans.
pub(crate) fn purge_store_scripts_for_collection(app: &AppHandle, collection_id: &str) {
    let Ok(store) = app.store(STORE_FILE) else {
        return;
    };
    let mut map: HashMap<String, Value> = store
        .get(SCRIPTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let prefix = format!("{}_", collection_id);
    let before = map.len();
    map.retain(|k, _| !k.starts_with(&prefix));
    if map.len() != before {
        store.set(SCRIPTS_KEY.to_string(), serde_json::to_value(map).unwrap());
        let _ = store.save();
    }
}

#[tauri::command]
pub async fn script_get(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<ScriptData, String> {
    let endpoint_data = super::collections::collection_get_endpoint_data(
        app.clone(),
        collection_id.clone(),
        endpoint_id.clone(),
    )
    .await?;

    if let Some(value) = endpoint_data.scripts.clone()
        && let Ok(scripts) = serde_json::from_value::<ScriptData>(value)
    {
        return Ok(scripts);
    }

    // Fallback: legacy global-store entry. Migrate into the per-endpoint file
    // on hit so the next read goes through the fast path above.
    let legacy_key = format!("{}_{}", collection_id, endpoint_id);
    if let Some(scripts) = read_legacy_store_script(&app, &legacy_key) {
        if !scripts_are_empty(&scripts) {
            let _ = write_scripts_to_endpoint_file(
                &app,
                collection_id.clone(),
                endpoint_id.clone(),
                scripts.clone(),
            )
            .await;
            remove_store_script_entry(&app, &collection_id, &endpoint_id);
        }
        return Ok(scripts);
    }

    Ok(ScriptData {
        pre_request_script: String::new(),
        test_script: String::new(),
    })
}

async fn write_scripts_to_endpoint_file(
    app: &AppHandle,
    collection_id: String,
    endpoint_id: String,
    scripts: ScriptData,
) -> Result<(), String> {
    let mut endpoint_data = super::collections::collection_get_endpoint_data(
        app.clone(),
        collection_id.clone(),
        endpoint_id.clone(),
    )
    .await?;

    endpoint_data.scripts = if scripts_are_empty(&scripts) {
        None
    } else {
        Some(serde_json::to_value(&scripts).map_err(|e| e.to_string())?)
    };

    super::collections::collection_save_endpoint_data(
        app.clone(),
        collection_id,
        endpoint_id,
        endpoint_data,
    )
    .await
}

#[tauri::command]
pub async fn script_save(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
    scripts: ScriptData,
) -> Result<(), String> {
    write_scripts_to_endpoint_file(&app, collection_id.clone(), endpoint_id.clone(), scripts)
        .await?;
    remove_store_script_entry(&app, &collection_id, &endpoint_id);
    Ok(())
}
