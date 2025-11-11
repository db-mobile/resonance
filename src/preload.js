/**
 * @fileoverview Preload script for secure IPC communication
 * @module preload
 *
 * Exposes a safe API to the renderer process through contextBridge.
 * This script runs in a privileged context and bridges the gap between
 * the main process and renderer process with context isolation enabled.
 * All IPC communication is channeled through the exposed electronAPI.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes the electronAPI to the renderer process
 *
 * Provides safe access to main process functionality including:
 * - API requests (send, cancel)
 * - Data persistence (electron-store)
 * - OpenAPI collection imports
 * - Application settings
 * - Proxy configuration
 * - Logging (forwarded to main process)
 *
 * @namespace electronAPI
 * @global
 */
contextBridge.exposeInMainWorld('electronAPI', {
    logger: {
        error: (scope, message, meta) => ipcRenderer.invoke('logger:error', scope, message, meta),
        warn: (scope, message, meta) => ipcRenderer.invoke('logger:warn', scope, message, meta),
        info: (scope, message, meta) => ipcRenderer.invoke('logger:info', scope, message, meta),
        debug: (scope, message, meta) => ipcRenderer.invoke('logger:debug', scope, message, meta),
        verbose: (scope, message, meta) => ipcRenderer.invoke('logger:verbose', scope, message, meta)
    },
    sendApiRequest: (requestOptions) => ipcRenderer.invoke('send-api-request', requestOptions),
    cancelApiRequest: () => ipcRenderer.invoke('cancel-api-request'),
    store: {
        get: (key) => ipcRenderer.invoke('store:get', key),
        set: (key, value) => ipcRenderer.invoke('store:set', key, value)
    },
    collections: {
        importOpenApiFile: () => ipcRenderer.invoke('import-openapi-file')
    },
    settings: {
        get: () => ipcRenderer.invoke('settings:get'),
        set: (settings) => ipcRenderer.invoke('settings:set', settings)
    },
    proxySettings: {
        get: () => ipcRenderer.invoke('proxy:get'),
        set: (settings) => ipcRenderer.invoke('proxy:set', settings),
        test: () => ipcRenderer.invoke('proxy:test')
    }
});