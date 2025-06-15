const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendApiRequest: (requestOptions) => ipcRenderer.invoke('send-api-request', requestOptions)
});