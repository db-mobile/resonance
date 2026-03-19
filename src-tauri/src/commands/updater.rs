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

pub struct PendingUpdate(pub Mutex<Option<Update>>);

impl Default for PendingUpdate {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

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

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return Err(UpdateError::Updater(format!(
                "Failed to initialize updater: {}",
                e
            )))
        }
    };

    let update = match updater.check().await {
        Ok(u) => u,
        Err(e) => {
            return Err(UpdateError::Updater(format!(
                "Failed to check for updates: {}",
                e
            )))
        }
    };

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

#[tauri::command]
pub async fn updater_download_and_install(
    #[allow(unused_variables)] app: AppHandle,
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

    let update = pending_update.0.lock().unwrap().take();

    let Some(update) = update else {
        return Err(UpdateError::NoPendingUpdate);
    };

    update.download_and_install(|_, _| {}, || {}).await?;

    Ok(())
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

#[tauri::command]
pub fn updater_get_install_info() -> InstallInfo {
    // Debug: allow overriding install type via env var for testing
    #[cfg(debug_assertions)]
    if let Ok(override_type) = env::var("RESONANCE_INSTALL_TYPE") {
        return match override_type.as_str() {
            "flatpak" => InstallInfo {
                auto_update_supported: false,
                install_type: "flatpak".to_string(),
                message: Some("Updates are managed by Flatpak".to_string()),
            },
            "snap" => InstallInfo {
                auto_update_supported: false,
                install_type: "snap".to_string(),
                message: Some("Updates are managed by Snap".to_string()),
            },
            "system" => InstallInfo {
                auto_update_supported: false,
                install_type: "system".to_string(),
                message: Some("Updates are managed by your package manager".to_string()),
            },
            "homebrew" => InstallInfo {
                auto_update_supported: false,
                install_type: "homebrew".to_string(),
                message: Some("Updates are managed by Homebrew".to_string()),
            },
            "scoop" => InstallInfo {
                auto_update_supported: false,
                install_type: "scoop".to_string(),
                message: Some("Updates are managed by Scoop".to_string()),
            },
            "appimage" => InstallInfo {
                auto_update_supported: true,
                install_type: "appimage".to_string(),
                message: None,
            },
            _ => InstallInfo {
                auto_update_supported: true,
                install_type: "direct".to_string(),
                message: None,
            },
        };
    }

    // Check for Flatpak
    if env::var("FLATPAK_ID").is_ok() {
        return InstallInfo {
            auto_update_supported: false,
            install_type: "flatpak".to_string(),
            message: Some("Updates are managed by Flatpak".to_string()),
        };
    }

    // Check for Snap
    if env::var("SNAP").is_ok() {
        return InstallInfo {
            auto_update_supported: false,
            install_type: "snap".to_string(),
            message: Some("Updates are managed by Snap".to_string()),
        };
    }

    // Check for AppImage (supports auto-update)
    if env::var("APPIMAGE").is_ok() {
        return InstallInfo {
            auto_update_supported: true,
            install_type: "appimage".to_string(),
            message: None,
        };
    }

    // Check for Homebrew on macOS
    #[cfg(target_os = "macos")]
    {
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy();
            if path_str.contains("/Caskroom/") || path_str.contains("/Cellar/") {
                return InstallInfo {
                    auto_update_supported: false,
                    install_type: "homebrew".to_string(),
                    message: Some("Updates are managed by Homebrew".to_string()),
                };
            }
        }
    }

    // Check for Scoop on Windows
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy().to_lowercase();
            if path_str.contains("\\scoop\\") {
                return InstallInfo {
                    auto_update_supported: false,
                    install_type: "scoop".to_string(),
                    message: Some("Updates are managed by Scoop".to_string()),
                };
            }
        }
    }

    // Check for Linux system package (installed in /usr)
    #[cfg(target_os = "linux")]
    {
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy();
            if path_str.starts_with("/usr/") {
                return InstallInfo {
                    auto_update_supported: false,
                    install_type: "system".to_string(),
                    message: Some("Updates are managed by your package manager".to_string()),
                };
            }
        }
    }

    // Default: direct installation, auto-update supported
    InstallInfo {
        auto_update_supported: true,
        install_type: "direct".to_string(),
        message: None,
    }
}
