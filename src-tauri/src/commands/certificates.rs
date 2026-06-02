//! File-picker support for the client-certificate (mTLS) settings UI.
//!
//! The certificate store itself lives in the frontend (persisted via the
//! key-value store as `clientCertificates`, holding only file paths). The only
//! backend surface needed is a native file dialog to choose PEM cert/key/CA
//! files, mirroring [`grpc_select_proto_file`](super::grpc_proto::grpc_select_proto_file).

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

/// Open a file dialog to select a certificate-related PEM file.
///
/// `kind` selects the dialog's file filter: `"cert"` for a client certificate
/// chain, `"key"` for a private key, or `"ca"` for a CA bundle. Any other value
/// falls back to a generic certificate filter. Returns the chosen path, or
/// `None` if the dialog was cancelled.
#[tauri::command]
pub async fn pick_certificate_file(app: AppHandle, kind: String) -> Result<Option<String>, String> {
    let (name, extensions): (&str, &[&str]) = match kind.as_str() {
        "key" => ("Private Key", &["pem", "key"]),
        "ca" => ("CA Certificate", &["pem", "crt", "cer", "ca"]),
        _ => ("Certificate", &["pem", "crt", "cer"]),
    };

    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .add_filter(name, extensions)
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            let result = file_path.map(|fp| match fp {
                FilePath::Path(p) => p.to_string_lossy().to_string(),
                FilePath::Url(u) => u.path().to_string(),
            });
            let _ = tx.send(result);
        });

    rx.await.map_err(|e| format!("Dialog error: {}", e))
}
