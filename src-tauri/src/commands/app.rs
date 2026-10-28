use tauri::{AppHandle, Theme, Window};

#[tauri::command]
pub fn app_get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn app_set_window_theme(window: Window, theme: String) -> Result<(), String> {
    let theme = match theme.as_str() {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };
    window.set_theme(theme).map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    window
        .run_on_main_thread(crate::gtk_theme::ensure_loadable)
        .map_err(|error| error.to_string())?;
    Ok(())
}
