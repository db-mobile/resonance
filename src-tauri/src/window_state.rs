use gtk::prelude::*;
use serde::Deserialize;
use std::sync::{
    OnceLock,
    atomic::{AtomicBool, Ordering},
};
use tauri::{LogicalPosition, LogicalSize, Manager, PhysicalSize, Runtime, WindowEvent};
use tauri_plugin_window_state::AppHandleExt;

#[derive(Deserialize)]
struct SavedWindows {
    main: Option<SavedWindow>,
}

#[derive(Deserialize)]
struct SavedWindow {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    prev_x: i32,
    prev_y: i32,
    maximized: bool,
    fullscreen: bool,
}

impl SavedWindow {
    fn logical_bounds(
        &self,
        scale: f64,
        decorations: (i32, i32),
    ) -> (LogicalSize<f64>, LogicalPosition<f64>) {
        let (x, y) = if self.maximized {
            (self.prev_x, self.prev_y)
        } else {
            (self.x, self.y)
        };
        (
            LogicalSize::new(
                (self.width as f64 / scale - f64::from(decorations.0)).max(1.0),
                (self.height as f64 / scale - f64::from(decorations.1)).max(1.0),
            ),
            LogicalPosition::new(x as f64 / scale, y as f64 / scale),
        )
    }
}

/// Restore after GTK focuses the window, when its monitor and decorations are
/// known. Tauri's early scale can be 1 on a scaled display, and its saved size
/// includes CSD extents which GTK's resize API excludes (plugins-workspace#3553).
/// The window-state plugin continues to track and save subsequent changes.
pub fn restore_main_window<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let path = app.path().app_config_dir()?.join(app.handle().filename());
    let saved = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SavedWindows>(&bytes).ok())
        .and_then(|windows| windows.main);
    let Some(saved) = saved.filter(|state| state.width > 0 && state.height > 0) else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let expected_size = OnceLock::new();
    let mode_restored = AtomicBool::new(false);
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Focused(true) | WindowEvent::ScaleFactorChanged { .. }
        ) && expected_size.get().is_none()
        {
            match restore_saved_window(&window_clone, &saved) {
                Ok(size) => {
                    let _ = expected_size.set(size);
                }
                Err(error) => tracing::warn!(%error, "Failed to restore main window state"),
            }
        }
        // GTK must finish resizing before maximization, otherwise it remembers
        // the startup default as the size to return to when unmaximized.
        let size = match event {
            WindowEvent::Resized(size) => Some(*size),
            WindowEvent::Focused(true) | WindowEvent::ScaleFactorChanged { .. } => {
                window_clone.inner_size().ok()
            }
            _ => None,
        };
        if let Some(size) = size
            && (saved.maximized || saved.fullscreen)
            && expected_size.get().is_some_and(|expected| {
                size.width.abs_diff(expected.width) <= 1
                    && size.height.abs_diff(expected.height) <= 1
            })
            && !mode_restored.swap(true, Ordering::Relaxed)
        {
            if saved.maximized
                && let Err(error) = window_clone.maximize()
            {
                tracing::warn!(%error, "Failed to restore main window maximization");
            }
            if saved.fullscreen
                && let Err(error) = window_clone.set_fullscreen(true)
            {
                tracing::warn!(%error, "Failed to restore main window fullscreen state");
            }
        }
    });
    Ok(())
}

fn restore_saved_window<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    saved: &SavedWindow,
) -> tauri::Result<PhysicalSize<u32>> {
    let native = window.gtk_window()?;
    let (width, height) = native.size();
    let decorations = native
        .window()
        .map(|surface| (surface.width() - width, surface.height() - height))
        .unwrap_or_default();
    let scale = window
        .current_monitor()?
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(f64::from(native.scale_factor()));
    let (mut size, position) = saved.logical_bounds(scale, decorations);
    if let Some(config) = window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
    {
        size.width = size.width.max(config.min_width.unwrap_or(1.0));
        size.height = size.height.max(config.min_height.unwrap_or(1.0));
    }
    let physical = position.to_physical::<i32>(scale);
    let on_screen = window.available_monitors()?.iter().any(|monitor| {
        let origin = monitor.position();
        let extent = monitor.size();
        i64::from(physical.x) < i64::from(origin.x) + i64::from(extent.width)
            && i64::from(physical.x) + i64::from(saved.width) > i64::from(origin.x)
            && i64::from(physical.y) < i64::from(origin.y) + i64::from(extent.height)
            && i64::from(physical.y) + i64::from(saved.height) > i64::from(origin.y)
    });
    if on_screen {
        native.move_(position.x.round() as i32, position.y.round() as i32);
    }
    native.resize(size.width.round() as i32, size.height.round() as i32);
    Ok(LogicalSize::new(
        size.width + f64::from(decorations.0),
        size.height + f64::from(decorations.1),
    )
    .to_physical(scale))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved_window() -> SavedWindow {
        serde_json::from_str::<SavedWindows>(
            r#"{"main":{"width":3258,"height":2058,"x":200,"y":100,
                "prev_x":80,"prev_y":60,"maximized":false,"visible":true,
                "decorated":true,"fullscreen":false}}"#,
        )
        .unwrap()
        .main
        .unwrap()
    }

    #[test]
    fn restores_existing_physical_state_at_monitor_scale() {
        let saved = saved_window();
        let (size, position) = saved.logical_bounds(2.0, (0, 0));
        assert_eq!(size, LogicalSize::new(1629.0, 1029.0));
        assert_eq!(position, LogicalPosition::new(100.0, 50.0));
        assert_eq!(size.to_physical::<u32>(2.0).width, saved.width);
        assert_eq!(size.to_physical::<u32>(2.0).height, saved.height);
    }

    #[test]
    fn preserves_bounds_on_unscaled_displays() {
        let (size, position) = saved_window().logical_bounds(1.0, (0, 0));
        assert_eq!(size, LogicalSize::new(3258.0, 2058.0));
        assert_eq!(position, LogicalPosition::new(200.0, 100.0));
    }

    #[test]
    fn restores_pre_maximization_position() {
        let mut saved = saved_window();
        saved.maximized = true;
        let (_, position) = saved.logical_bounds(2.0, (0, 0));
        assert_eq!(position, LogicalPosition::new(40.0, 30.0));
    }

    #[test]
    fn repeated_restores_do_not_add_client_side_decorations() {
        let mut saved = saved_window();
        for _ in 0..10 {
            let (size, _) = saved.logical_bounds(2.0, (52, 89));
            // GTK reports the surface (content plus decorations) back to the plugin.
            saved.width = ((size.width + 52.0) * 2.0).round() as u32;
            saved.height = ((size.height + 89.0) * 2.0).round() as u32;
            assert_eq!((saved.width, saved.height), (3258, 2058));
        }
    }

    #[test]
    fn client_side_decorations_cannot_produce_negative_content_sizes() {
        let mut saved = saved_window();
        saved.width = 1;
        saved.height = 1;
        let (size, _) = saved.logical_bounds(2.0, (52, 89));
        assert_eq!(size, LogicalSize::new(1.0, 1.0));
    }
}
