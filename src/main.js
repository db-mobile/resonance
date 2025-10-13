import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import Store from 'electron-store';

// Import modular components
import WindowManager from './main/windowManager.js';
import ApiRequestHandler from './main/apiRequestHandlers.js';
import StoreHandler from './main/storeHandlers.js';
import SchemaProcessor from './main/schemaProcessor.js';
import OpenApiParser from './main/openApiParser.js';

// Initialize electron-store
const store = new Store({
    name: 'api-collections',
    defaults: {
        collections: []
    }
});

// Initialize managers and handlers
const windowManager = new WindowManager();
const apiRequestHandler = new ApiRequestHandler(store);
const storeHandler = new StoreHandler(store);
const schemaProcessor = new SchemaProcessor();
const openApiParser = new OpenApiParser(schemaProcessor, store);

// App lifecycle
app.whenReady().then(() => {
    windowManager.createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            windowManager.createWindow();
        }
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- IPC Handlers for API Requests ---
ipcMain.handle('send-api-request', async (event, requestOptions) => {
    return apiRequestHandler.handleApiRequest(requestOptions);
});

ipcMain.handle('cancel-api-request', async (event) => {
    return apiRequestHandler.cancelRequest();
});

// --- IPC Handlers for Store Operations ---
ipcMain.handle('store:get', (event, key) => {
    return storeHandler.get(key);
});

ipcMain.handle('store:set', (event, key, value) => {
    storeHandler.set(key, value);
});

// --- IPC Handlers for Settings ---
ipcMain.handle('settings:get', () => {
    return storeHandler.getSettings();
});

ipcMain.handle('settings:set', (event, settings) => {
    storeHandler.setSettings(settings);
});

// --- IPC Handler for OpenAPI Collection Import ---
ipcMain.handle('import-openapi-file', async () => {
    const mainWindow = windowManager.getMainWindow();

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'OpenAPI Files', extensions: ['yml', 'yaml', 'json'] }
        ]
    });

    if (result.canceled) {
        return null;
    }

    try {
        const filePath = result.filePaths[0];
        const collection = await openApiParser.importOpenApiFile(filePath);
        return collection;
    } catch (error) {
        console.error('Error importing OpenAPI file:', error);
        throw error;
    }
});
