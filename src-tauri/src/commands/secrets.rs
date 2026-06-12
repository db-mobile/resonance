//! OS keychain access for secret values (encryption at rest).
//!
//! Backed by the `keyring` crate: the D-Bus Secret Service on Linux (RustCrypto, no
//! OpenSSL — see Cargo.toml), and the native credential stores on macOS/Windows. The
//! frontend `SecretStore` keeps only a non-sensitive index of which secrets exist and
//! reads the values through these commands; nothing secret is written to the plaintext
//! store file once the keychain backend is active.
//!
//! Each secret is addressed by an opaque `account` string built by the frontend
//! (`<scope>|<key>`). The keychain calls are synchronous, so they run on a blocking
//! thread to avoid stalling the async runtime.

use keyring::{Entry, Error as KeyringError};

const KEYRING_SERVICE: &str = "resonance";

fn make_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())
}

/// Stores (or overwrites) a secret value.
#[tauri::command]
pub async fn secret_set(account: String, value: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        make_entry(&account)?
            .set_password(&value)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Retrieves a secret value, or `None` if it does not exist.
#[tauri::command]
pub async fn secret_get(account: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let entry = make_entry(&account)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes a secret. A missing entry is treated as success (idempotent).
#[tauri::command]
pub async fn secret_delete(account: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let entry = make_entry(&account)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Probes whether a usable OS keychain is available by round-tripping a sentinel value.
/// Returns `false` on headless/locked systems so the frontend can fall back gracefully.
#[tauri::command]
pub async fn secret_keychain_available() -> bool {
    tokio::task::spawn_blocking(|| {
        let entry = match Entry::new(KEYRING_SERVICE, "__resonance_probe__") {
            Ok(entry) => entry,
            Err(_) => return false,
        };
        if entry.set_password("probe").is_err() {
            return false;
        }
        let ok = matches!(entry.get_password(), Ok(value) if value == "probe");
        let _ = entry.delete_credential();
        ok
    })
    .await
    .unwrap_or(false)
}
