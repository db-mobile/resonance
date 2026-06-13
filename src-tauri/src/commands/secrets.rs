//! OS keychain access for secret values (encryption at rest).
//!
//! Two backends sit behind the same four commands; the frontend `SecretStore` is
//! unaware of which is active and keeps only a non-sensitive index of which secrets
//! exist:
//!
//! * **Default (`keyring` crate):** the D-Bus Secret Service on Linux (RustCrypto, no
//!   OpenSSL — see Cargo.toml), and the native credential stores on macOS/Windows. Used
//!   for every build except a Flatpak sandbox.
//! * **Flatpak portal (`oo7`, Linux only):** when running inside a Flatpak sandbox we use
//!   the `org.freedesktop.portal.Secret` portal, which encrypts secrets in an app-private
//!   file keyed by the portal. This avoids requesting `--talk-name=org.freedesktop.secrets`
//!   in the Flatpak manifest (a non-portal permission that Flathub flags). Secrets stored
//!   this way live only in the sandbox and are not shared with native installs.
//!
//! Each secret is addressed by an opaque `account` string built by the frontend
//! (`<scope>|<key>`). The keyring calls are synchronous, so they run on a blocking thread
//! to avoid stalling the async runtime; the portal calls are natively async.

use keyring::{Entry, Error as KeyringError};

const KEYRING_SERVICE: &str = "resonance";

fn make_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())
}

/// True when running inside a Flatpak sandbox, where the Secret Service is unreachable
/// without a non-portal permission and the portal backend should be used instead.
#[cfg(target_os = "linux")]
fn use_portal() -> bool {
    std::path::Path::new("/.flatpak-info").exists()
}

/// Flatpak Secret-portal backend (`oo7`). Items are addressed by an `account` attribute
/// so the same opaque key the frontend already uses maps straight through.
#[cfg(target_os = "linux")]
mod portal {
    use oo7::Keyring;
    use std::collections::HashMap;
    use tokio::sync::OnceCell;

    // The portal keyring is opened once and shared; opening it derives the file
    // encryption key from the portal, which is comparatively expensive.
    static KEYRING: OnceCell<Keyring> = OnceCell::const_new();

    async fn keyring() -> Result<&'static Keyring, String> {
        KEYRING
            .get_or_try_init(|| async {
                let kr = Keyring::new().await.map_err(|e| e.to_string())?;
                kr.unlock().await.map_err(|e| e.to_string())?;
                Ok::<Keyring, String>(kr)
            })
            .await
    }

    fn attrs(account: &str) -> HashMap<&str, &str> {
        HashMap::from([
            ("application", "io.github.db_mobile.resonance"),
            ("account", account),
        ])
    }

    pub async fn set(account: String, value: String) -> Result<(), String> {
        let kr = keyring().await?;
        kr.create_item(&account, &attrs(&account), value.as_bytes(), true)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get(account: String) -> Result<Option<String>, String> {
        let kr = keyring().await?;
        let items = kr
            .search_items(&attrs(&account))
            .await
            .map_err(|e| e.to_string())?;
        match items.first() {
            Some(item) => {
                let secret = item.secret().await.map_err(|e| e.to_string())?;
                Ok(Some(String::from_utf8_lossy(&secret).into_owned()))
            }
            None => Ok(None),
        }
    }

    pub async fn delete(account: String) -> Result<(), String> {
        let kr = keyring().await?;
        kr.delete(&attrs(&account)).await.map_err(|e| e.to_string())
    }

    pub async fn available() -> bool {
        let Ok(kr) = keyring().await else {
            return false;
        };
        let probe = attrs("__resonance_probe__");
        if kr
            .create_item("__resonance_probe__", &probe, b"probe".as_slice(), true)
            .await
            .is_err()
        {
            return false;
        }
        let ok = matches!(kr.search_items(&probe).await, Ok(items) if !items.is_empty());
        let _ = kr.delete(&probe).await;
        ok
    }
}

/// Stores (or overwrites) a secret value.
#[tauri::command]
pub async fn secret_set(account: String, value: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if use_portal() {
        return portal::set(account, value).await;
    }
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
    #[cfg(target_os = "linux")]
    if use_portal() {
        return portal::get(account).await;
    }
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
    #[cfg(target_os = "linux")]
    if use_portal() {
        return portal::delete(account).await;
    }
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

/// Probes whether a usable secret backend is available by round-tripping a sentinel value.
/// Returns `false` on headless/locked systems so the frontend can fall back gracefully.
#[tauri::command]
pub async fn secret_keychain_available() -> bool {
    #[cfg(target_os = "linux")]
    if use_portal() {
        return portal::available().await;
    }
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
