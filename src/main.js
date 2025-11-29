/**
 * @fileoverview Main process entry point for Resonance Electron application
 * @module main
 *
 * Initializes the Electron application, sets up IPC handlers, and manages
 * the application lifecycle. Coordinates communication between the main
 * process and renderer process through secure IPC channels.
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import Store from 'electron-store';

import fs from 'fs/promises';
import WindowManager from './main/windowManager.js';
import ApiRequestHandler from './main/apiRequestHandlers.js';
import StoreHandler from './main/storeHandlers.js';
import ProxyHandler from './main/proxyHandlers.js';
import SchemaProcessor from './main/schemaProcessor.js';
import OpenApiParser from './main/openApiParser.js';
import PostmanParser from './main/postmanParser.js';
import OpenApiExporter from './main/openApiExporter.js';
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
const postmanParser = new PostmanParser(store);
const openApiExporter = new OpenApiExporter();

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

ipcMain.handle('import-postman-collection', async () => {
    const mainWindow = windowManager.getMainWindow();

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Postman Collection', extensions: ['json'] }
        ]
    });

    if (result.canceled) {
        return null;
    }

    try {
        const filePath = result.filePaths[0];
        const importResult = await postmanParser.importPostmanFile(filePath);
        return importResult;
    } catch (error) {
        console.error('Error importing Postman collection:', error);
        throw error;
    }
});

ipcMain.handle('import-postman-environment', async () => {
    const mainWindow = windowManager.getMainWindow();

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Postman Environment', extensions: ['json'] }
        ]
    });

    if (result.canceled) {
        return null;
    }

    try {
        const filePath = result.filePaths[0];
        const environment = await postmanParser.importPostmanEnvironment(filePath);
        return environment;
    } catch (error) {
        console.error('Error importing Postman environment:', error);
        throw error;
    }
});

// Export OpenAPI collection
ipcMain.handle('export-openapi', async (_event, collectionId, format) => {
    const mainWindow = windowManager.getMainWindow();

    try {
        // Get collection from store
        const collections = store.get('collections');
        if (!Array.isArray(collections)) {
            throw new Error('No collections found in store');
        }

        const collection = collections.find(c => c.id === collectionId);
        if (!collection) {
            throw new Error(`Collection with id ${collectionId} not found`);
        }

        // Show save dialog
        const fileExtension = format === 'yaml' ? 'yaml' : 'json';
        const filterName = format === 'yaml' ? 'YAML Files' : 'JSON Files';

        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Export as OpenAPI',
            defaultPath: `${collection.name}.openapi.${fileExtension}`,
            filters: [
                { name: filterName, extensions: [fileExtension] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (result.canceled || !result.filePath) {
            return { success: false, cancelled: true };
        }

        // Export collection to OpenAPI format
        const openApiContent = openApiExporter.exportToOpenApi(collection, format);

        // Write file
        await fs.writeFile(result.filePath, openApiContent, 'utf8');

        return {
            success: true,
            filePath: result.filePath,
            format: format
        };
    } catch (error) {
        console.error('Error exporting OpenAPI collection:', error);
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

// DevTools toggle handler
ipcMain.handle('devtools:toggle', () => {
    const mainWindow = BrowserWindow.getFocusedWindow();
    if (mainWindow) {
        mainWindow.webContents.toggleDevTools();
    }
});
