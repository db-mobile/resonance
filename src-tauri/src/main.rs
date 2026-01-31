#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{
    api_request::{cancel_api_request, send_api_request, RequestState},
    app::app_get_version,
    import_export::{
        export_openapi, import_openapi_file, import_postman_collection, import_postman_environment,
    },
    mock_server::{
        mock_server_clear_logs, mock_server_logs, mock_server_reload_settings, mock_server_start,
        mock_server_status, mock_server_stop,
    },
    proxy::{proxy_get, proxy_set, proxy_test, ProxyState},
    scripts::{script_execute_pre_request, script_execute_test, script_get, script_save},
    store::{settings_get, settings_set, store_get, store_set},
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(RequestState::default())
        .manage(ProxyState::default())
        .invoke_handler(tauri::generate_handler![
            // App
            app_get_version,
            // Store
            store_get,
            store_set,
            settings_get,
            settings_set,
            // API Requests
            send_api_request,
            cancel_api_request,
            // Proxy
            proxy_get,
            proxy_set,
            proxy_test,
            // Import/Export
            import_openapi_file,
            import_postman_collection,
            import_postman_environment,
            export_openapi,
            // Mock Server
            mock_server_start,
            mock_server_stop,
            mock_server_status,
            mock_server_logs,
            mock_server_clear_logs,
            mock_server_reload_settings,
            // Scripts
            script_get,
            script_save,
            script_execute_pre_request,
            script_execute_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
