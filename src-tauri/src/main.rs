#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{
    api_request::{cancel_api_request, send_api_request, RequestState},
    app::app_get_version,
    certificates::pick_certificate_file,
    collections::{
        collection_delete, collection_delete_endpoint_data, collection_get,
        collection_get_endpoint_data, collection_get_variables, collection_save,
        collection_save_endpoint_data, collection_save_variables, collections_get_all,
        collections_get_path, collections_list, collections_migrate, collections_needs_migration,
        collections_pick_directory,
    },
    grpc_proto::{
        grpc_list_loaded_protos, grpc_parse_proto_file, grpc_proto_get_input_skeleton,
        grpc_proto_invoke_unary, grpc_select_proto_file, grpc_unload_proto, ProtoState,
    },
    grpc_reflection::{
        grpc_get_input_skeleton, grpc_invoke_unary, grpc_reflection_list_methods,
        grpc_reflection_list_services,
    },
    grpc_streaming::{grpc_stream_cancel, grpc_stream_send, grpc_stream_start, GrpcStreamingState},
    import_export::{
        collections_pick_import_file, export_openapi, export_postman, import_openapi_file,
        import_postman_collection, import_postman_environment, save_documentation,
        save_json_export,
    },
    mock_server::{
        mock_server_clear_logs, mock_server_logs, mock_server_reload_settings, mock_server_start,
        mock_server_status, mock_server_stop,
    },
    mqtt::{mqtt_close, mqtt_connect, mqtt_publish, MqttState},
    oauth::{
        oauth2_build_authorization_url, oauth2_generate_pkce, oauth2_generate_state,
        oauth2_get_pkce_verifier, oauth2_get_token, oauth2_store_pkce_verifier, OAuth2State,
    },
    proxy::{proxy_get, proxy_set, proxy_test, ProxyState},
    scripts::{script_execute_pre_request, script_execute_test, script_get, script_save},
    secrets::{secret_delete, secret_get, secret_keychain_available, secret_set},
    sse::{sse_close, sse_connect, SseState},
    store::{settings_get, settings_set, store_get, store_set},
    updater::{
        updater_check, updater_download_and_install, updater_get_install_info, PendingUpdate,
    },
    websocket::{websocket_close, websocket_send, WebSocketState},
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .manage(RequestState::default())
        .manage(ProxyState::default())
        .manage(ProtoState::default())
        .manage(GrpcStreamingState::default())
        .manage(WebSocketState::default())
        .manage(SseState::default())
        .manage(MqttState::default())
        .manage(PendingUpdate::default())
        .manage(OAuth2State::default())
        .invoke_handler(tauri::generate_handler![
            // App
            app_get_version,
            // Store
            store_get,
            store_set,
            settings_get,
            settings_set,
            // Secrets (OS keychain)
            secret_set,
            secret_get,
            secret_delete,
            secret_keychain_available,
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
            collections_pick_import_file,
            export_openapi,
            export_postman,
            save_json_export,
            save_documentation,
            // gRPC Reflection
            grpc_reflection_list_services,
            grpc_reflection_list_methods,
            grpc_invoke_unary,
            grpc_get_input_skeleton,
            // gRPC Proto Files
            grpc_select_proto_file,
            grpc_parse_proto_file,
            grpc_proto_get_input_skeleton,
            grpc_proto_invoke_unary,
            grpc_list_loaded_protos,
            grpc_unload_proto,
            // Client certificates (mTLS)
            pick_certificate_file,
            // gRPC Streaming
            grpc_stream_start,
            grpc_stream_send,
            grpc_stream_cancel,
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
            // WebSocket
            websocket_send,
            websocket_close,
            // SSE
            sse_connect,
            sse_close,
            // MQTT
            mqtt_connect,
            mqtt_publish,
            mqtt_close,
            // OAuth 2.0
            oauth2_generate_pkce,
            oauth2_generate_state,
            oauth2_store_pkce_verifier,
            oauth2_get_pkce_verifier,
            oauth2_build_authorization_url,
            oauth2_get_token,
            // Updater
            updater_check,
            updater_download_and_install,
            updater_get_install_info,
            // Collections (file-based)
            collections_list,
            collections_get_all,
            collection_get,
            collection_save,
            collection_delete,
            collection_get_endpoint_data,
            collection_save_endpoint_data,
            collection_delete_endpoint_data,
            collection_get_variables,
            collection_save_variables,
            collections_needs_migration,
            collections_migrate,
            collections_get_path,
            collections_pick_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
