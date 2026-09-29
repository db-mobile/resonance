use serde::Serialize;
use std::env;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("{0}")]
    Updater(String),
    #[error("there is no pending update")]
    NoPendingUpdate,
}

impl From<tauri_plugin_updater::Error> for UpdateError {
    fn from(err: tauri_plugin_updater::Error) -> Self {
        UpdateError::Updater(err.to_string())
    }
}

impl Serialize for UpdateError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

type Result<T> = std::result::Result<T, UpdateError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: Option<String>,
    pub body: Option<String>,
}

#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<UpdateInfo> {
    // Debug: simulate finding an update
    #[cfg(debug_assertions)]
    if env::var("RESONANCE_SIMULATE_UPDATE").is_ok() {
        return Ok(UpdateInfo {
            available: true,
            version: Some("99.0.0".to_string()),
            current_version: Some(app.package_info().version.to_string()),
            body: Some(
                "This is a simulated update for testing.\n\n- New feature 1\n- Bug fix 2"
                    .to_string(),
            ),
        });
    }

    let updater = app
        .updater()
        .map_err(|e| UpdateError::Updater(format!("Failed to initialize updater: {}", e)))?;

    let update = updater
        .check()
        .await
        .map_err(|e| UpdateError::Updater(format!("Failed to check for updates: {}", e)))?;

    let info = match &update {
        Some(u) => UpdateInfo {
            available: true,
            version: Some(u.version.clone()),
            current_version: Some(u.current_version.clone()),
            body: u.body.clone(),
        },
        None => UpdateInfo {
            available: false,
            version: None,
            current_version: None,
            body: None,
        },
    };

    *pending_update.0.lock().unwrap() = update;

    Ok(info)
}

/// Downloads and installs the pending update, then restarts into it. The
/// update stays pending until the install succeeds, so a failed download can
/// simply be retried.
#[tauri::command]
pub async fn updater_download_and_install(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<()> {
    // Debug: simulate download and install (wait, then restart)
    #[cfg(debug_assertions)]
    if env::var("RESONANCE_SIMULATE_UPDATE").is_ok() {
        // Simulate download time
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        // Restart the app to simulate real update behavior
        app.restart();
    }

    let update = pending_update.0.lock().unwrap().clone();

    let Some(update) = update else {
        return Err(UpdateError::NoPendingUpdate);
    };

    update.download_and_install(|_, _| {}, || {}).await?;
    pending_update.0.lock().unwrap().take();

    app.restart();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    /// Whether auto-update is supported for this installation type
    pub auto_update_supported: bool,
    /// The type of installation (e.g., "appimage", "flatpak", "homebrew", "direct")
    pub install_type: String,
    /// Human-readable message for unsupported installations
    pub message: Option<String>,
}

/// What an installation type means for auto-update. Packaged installs are
/// updated by their package manager; anything unrecognised is a direct install.
fn install_info(install_type: &str) -> InstallInfo {
    let manager = match install_type {
        "flatpak" => Some("Flatpak"),
        "snap" => Some("Snap"),
        "system" => Some("your package manager"),
        "homebrew" => Some("Homebrew"),
        "scoop" => Some("Scoop"),
        _ => None,
    };
    let install_type = match (install_type, manager) {
        ("appimage", _) | (_, Some(_)) => install_type,
        _ => "direct",
    };

    InstallInfo {
        auto_update_supported: manager.is_none(),
        install_type: install_type.to_string(),
        message: manager.map(|manager| format!("Updates are managed by {}", manager)),
    }
}

#[tauri::command]
pub fn updater_get_install_info() -> InstallInfo {
    // Debug: allow overriding install type via env var for testing
    #[cfg(debug_assertions)]
    if let Ok(override_type) = env::var("RESONANCE_INSTALL_TYPE") {
        return install_info(&override_type);
    }

    // Check for Flatpak
    if env::var("FLATPAK_ID").is_ok() {
        return install_info("flatpak");
    }

    // Check for Snap
    if env::var("SNAP").is_ok() {
        return install_info("snap");
    }

    // Check for AppImage (supports auto-update)
    if env::var("APPIMAGE").is_ok() {
        return install_info("appimage");
    }

    // Check for Homebrew on macOS
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy();
            if path_str.contains("/Caskroom/") || path_str.contains("/Cellar/") {
                return install_info("homebrew");
            }
        }
    }

    // Check for Scoop on Windows
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy().to_lowercase();
            if path_str.contains("\\scoop\\") {
                return install_info("scoop");
            }
        }
    }

    // Check for Linux system package (installed in /usr)
    #[cfg(target_os = "linux")]
    {
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy();
            if path_str.starts_with("/usr/") {
                return install_info("system");
            }
        }
    }

    // Default: direct installation, auto-update supported
    install_info("direct")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_installs_defer_to_their_package_manager() {
        let flatpak = install_info("flatpak");
        assert!(!flatpak.auto_update_supported);
        assert_eq!(flatpak.install_type, "flatpak");
        assert_eq!(
            flatpak.message.as_deref(),
            Some("Updates are managed by Flatpak")
        );

        let system = install_info("system");
        assert_eq!(
            system.message.as_deref(),
            Some("Updates are managed by your package manager")
        );
    }

    #[test]
    fn appimage_and_unknown_types_self_update() {
        let appimage = install_info("appimage");
        assert!(appimage.auto_update_supported);
        assert_eq!(appimage.install_type, "appimage");
        assert!(appimage.message.is_none());

        let unknown = install_info("something-else");
        assert!(unknown.auto_update_supported);
        assert_eq!(unknown.install_type, "direct");
        assert!(unknown.message.is_none());
    }
}
