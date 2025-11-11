import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import Store from 'electron-store';

import WindowManager from './main/windowManager.js';
import ApiRequestHandler from './main/apiRequestHandlers.js';
import StoreHandler from './main/storeHandlers.js';
import ProxyHandler from './main/proxyHandlers.js';
import SchemaProcessor from './main/schemaProcessor.js';
import OpenApiParser from './main/openApiParser.js';
import loggerService from './services/LoggerService.js';

// Initialize logger for main process
loggerService.initialize({
    appName: 'Resonance',
    isDevelopment: !app.isPackaged
});

const store = new Store({
    name: 'api-collections',
    defaults: {
        collections: [],
        collectionVariables: {},
        modifiedRequestBodies: {},
        persistedPathParams: {},
        persistedQueryParams: {},
        persistedHeaders: {},
        persistedAuthConfigs: {},
        collectionExpansionStates: {},
        settings: {}
    }
});

try {
    const testKey = '__store_test__';
    store.set(testKey, true);
    store.delete(testKey);

    const requiredKeys = [
        'collections',
        'collectionVariables',
        'modifiedRequestBodies',
        'persistedPathParams',
        'persistedQueryParams',
        'persistedHeaders',
        'persistedAuthConfigs',
        'collectionExpansionStates',
        'settings'
    ];

    requiredKeys.forEach(key => {
        const value = store.get(key);
        if (value === undefined) {
            console.warn(`Key "${key}" returned undefined, initializing with default value`);
            const defaults = store.store;
            if (defaults[key] !== undefined) {
                store.set(key, defaults[key]);
            }
        }
    });

} catch (error) {
    console.error('ERROR: Store is not writable. This may cause issues in sandboxed environments:', error);
    console.error('Store path:', store.path);
}

const windowManager = new WindowManager();
const proxyHandler = new ProxyHandler(store);
const apiRequestHandler = new ApiRequestHandler(store, proxyHandler);
const storeHandler = new StoreHandler(store);
const schemaProcessor = new SchemaProcessor();
const openApiParser = new OpenApiParser(schemaProcessor, store);

app.whenReady().then(() => {
    windowManager.createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            windowManager.createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('send-api-request', async (_event, requestOptions) => apiRequestHandler.handleApiRequest(requestOptions));

ipcMain.handle('cancel-api-request', async (_event) => apiRequestHandler.cancelRequest());

ipcMain.handle('store:get', (_event, key) => storeHandler.get(key));

ipcMain.handle('store:set', (event, key, value) => {
    storeHandler.set(key, value);
});

ipcMain.handle('settings:get', () => storeHandler.getSettings());

ipcMain.handle('settings:set', (event, settings) => {
    storeHandler.setSettings(settings);
});

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

// Proxy settings handlers
ipcMain.handle('proxy:get', () => proxyHandler.getProxySettings());

ipcMain.handle('proxy:set', (_event, settings) => proxyHandler.setProxySettings(settings));

ipcMain.handle('proxy:test', async () => proxyHandler.testProxyConnection());

// Logger handlers - forward renderer logs to main process logger
ipcMain.handle('logger:error', (_event, scope, message, meta) => {
    const log = loggerService.scope(scope);
    log.error(message, meta);
});

ipcMain.handle('logger:warn', (_event, scope, message, meta) => {
    const log = loggerService.scope(scope);
    log.warn(message, meta);
});

ipcMain.handle('logger:info', (_event, scope, message, meta) => {
    const log = loggerService.scope(scope);
    log.info(message, meta);
});

ipcMain.handle('logger:debug', (_event, scope, message, meta) => {
    const log = loggerService.scope(scope);
    log.debug(message, meta);
});

ipcMain.handle('logger:verbose', (_event, scope, message, meta) => {
    const log = loggerService.scope(scope);
    log.verbose(message, meta);
});
