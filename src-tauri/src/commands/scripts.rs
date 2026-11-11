pub use resonance_core::scripts::*;
use tauri::AppHandle;

fn scripts_are_empty(scripts: &ScriptData) -> bool {
    scripts.pre_request_script.is_empty() && scripts.test_script.is_empty()
}

#[tauri::command]
pub async fn script_get(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<ScriptData, String> {
    let endpoint_data =
        super::collections::collection_get_endpoint_data(app, collection_id, endpoint_id).await?;

    Ok(endpoint_data
        .scripts
        .and_then(|value| serde_json::from_value::<ScriptData>(value).ok())
        .unwrap_or_else(|| ScriptData {
            pre_request_script: String::new(),
            test_script: String::new(),
        }))
}

#[tauri::command]
pub async fn script_save(
    app: AppHandle,
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
        app,
        collection_id,
        endpoint_id,
        endpoint_data,
    )
    .await
}
