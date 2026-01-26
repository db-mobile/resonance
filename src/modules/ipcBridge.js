/**
 * @fileoverview IPC Bridge
 * @module ipcBridge
 *
 * Provides a unified API for the renderer to call into the native backend.
 * Automatically detects the runtime environment and routes IPC calls accordingly.
 */

// Detect runtime environment
// In Tauri, __TAURI_INTERNALS__ is injected by the runtime
const isTauri = '__TAURI_INTERNALS__' in window;


let api;

if (isTauri) {
    // Tauri runtime - use the injected __TAURI_INTERNALS__.invoke
    
    const invoke = window.__TAURI_INTERNALS__.invoke;
    
    api = {
        logger: {
            error: (_scope, _message, _meta) => {
                void _scope;
                void _message;
                void _meta;
            },
            warn: (_scope, _message, _meta) => {
                void _scope;
                void _message;
                void _meta;
            },
            info: (_scope, _message, _meta) => {
                void _scope;
                void _message;
                void _meta;
            },
            debug: (_scope, _message, _meta) => {
                void _scope;
                void _message;
                void _meta;
            },
            verbose: (_scope, _message, _meta) => {
                void _scope;
                void _message;
                void _meta;
            }
        },
        sendApiRequest: (requestOptions) => invoke('send_api_request', { requestOptions }),
        cancelApiRequest: () => invoke('cancel_api_request'),
        store: {
            get: (key) => invoke('store_get', { key }),
            set: (key, value) => invoke('store_set', { key, value })
        },
        collections: {
            importOpenApiFile: () => invoke('import_openapi_file'),
            importPostmanCollection: () => invoke('import_postman_collection'),
            importPostmanEnvironment: () => invoke('import_postman_environment'),
            exportOpenApi: (collectionId, format) => invoke('export_openapi', { collectionId, format })
        },
        settings: {
            get: () => invoke('settings_get'),
            set: (settings) => invoke('settings_set', { settings })
        },
        proxySettings: {
            get: () => invoke('proxy_get'),
            set: (settings) => invoke('proxy_set', { settings }),
            test: () => invoke('proxy_test')
        },
        mockServer: {
            start: (settings, collections) => invoke('mock_server_start', { settings, collections }),
            stop: () => invoke('mock_server_stop'),
            status: () => invoke('mock_server_status'),
            logs: (limit) => invoke('mock_server_logs', { limit }),
            clearLogs: () => invoke('mock_server_clear_logs'),
            reloadSettings: () => invoke('mock_server_reload_settings')
        },
        scripts: {
            get: (collectionId, endpointId) => invoke('script_get', { collectionId, endpointId }),
            save: (collectionId, endpointId, scripts) => invoke('script_save', { collectionId, endpointId, scripts }),
            executePreRequest: (scriptData) => invoke('script_execute_pre_request', { scriptData }),
            executeTest: (scriptData) => invoke('script_execute_test', { scriptData })
        }
    };
    
    window.backendAPI = api;
} else if (window.backendAPI) {
    api = window.backendAPI;
} else {
    // No API available - this shouldn't happen in normal operation
}

export default api;
export { api, isTauri };
