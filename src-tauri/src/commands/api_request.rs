use super::proxy::ProxyState;
pub use resonance_core::api_request::*;
use tauri::State;
use tokio::sync::oneshot;

#[tauri::command]
pub async fn send_api_request(
    state: State<'_, RequestState>,
    proxy_state: State<'_, ProxyState>,
    request_options: RequestOptions,
) -> Result<ApiResponse, String> {
    resonance_core::api_request::send_api_request(&state, &proxy_state.snapshot(), request_options)
        .await
}

/// Open a file dialog to select a file for a request body (multipart file part
/// or raw binary body). Returns the chosen path, or `None` if cancelled.
/// Mirrors [`grpc_select_proto_file`](super::grpc_proto::grpc_select_proto_file)
/// but without an extension filter.
#[tauri::command]
pub async fn pick_upload_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let (tx, rx) = oneshot::channel();

    app.dialog().file().pick_file(move |file_path| {
        let result = file_path.map(|fp| match fp {
            FilePath::Path(p) => p.to_string_lossy().to_string(),
            FilePath::Url(u) => u.path().to_string(),
        });
        let _ = tx.send(result);
    });

    rx.await.map_err(|e| format!("Dialog error: {}", e))
}

/// Save a response body to a file the user picks in a native save dialog. The
/// body is passed base64-encoded so binary responses round-trip byte-for-byte.
/// Returns `{ success, cancelled?, filePath? }`.
#[tauri::command]
pub async fn save_response_body(
    app: tauri::AppHandle,
    default_file_name: String,
    base64_data: String,
) -> Result<serde_json::Value, String> {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let bytes = BASE64_STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Invalid response data: {}", e))?;

    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    app.dialog()
        .file()
        .set_file_name(default_file_name)
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    let file_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = file_path else {
        return Ok(serde_json::json!({ "success": false, "cancelled": true }));
    };

    let file_path = path.as_path().ok_or("Invalid file path")?;
    std::fs::write(file_path, &bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(serde_json::json!({
        "success": true,
        "filePath": file_path.to_string_lossy()
    }))
}
