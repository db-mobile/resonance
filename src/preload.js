const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    }
});