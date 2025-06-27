import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import Store from 'electron-store';
import windowStateKeeper from 'electron-window-state';
import axios from 'axios';
import yaml from 'js-yaml';

const store = new Store({
    name: 'api-collections',
    defaults: {
        collections: []
    }
});

let mainWindow;

function createWindow () {
    let mainWindowState = windowStateKeeper({
        defaultWidth: 1200,
        defaultHeight: 800
    });

    const win = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        webPreferences: {
            preload: path.join(process.cwd(), 'src', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindowState.manage(win);

    win.loadFile('index.html');

    mainWindow = win;
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handler for API Requests ---
ipcMain.handle('send-api-request', async (event, requestOptions) => {
    try {
        console.log('Received request options:', requestOptions);
        
        // Prepare the axios config
        const axiosConfig = {
            method: requestOptions.method,
            url: requestOptions.url,
            headers: requestOptions.headers || {},
            timeout: 30000, // 30 second timeout
        };

        // Handle request body for POST/PUT/PATCH requests
        if (requestOptions.body && ['POST', 'PUT', 'PATCH'].includes(requestOptions.method.toUpperCase())) {
            // If body is an object, stringify it for JSON requests
            if (typeof requestOptions.body === 'object') {
                axiosConfig.data = JSON.stringify(requestOptions.body);
                // Ensure Content-Type is set for JSON
                if (!axiosConfig.headers['Content-Type'] && !axiosConfig.headers['content-type']) {
                    axiosConfig.headers['Content-Type'] = 'application/json';
                }
            } else {
                // If body is already a string, use it as-is
                axiosConfig.data = requestOptions.body;
            }
        }

        console.log('Axios config:', axiosConfig);

        const response = await axios(axiosConfig);
        
        // Return success result
        return {
            success: true,
            data: response.data,
            status: response.status,
            statusText: response.statusText,
            headers: JSON.parse(JSON.stringify(response.headers))
        };
    } catch (error) {
        console.error('API request error:', error);
        
        // Create a serializable error object for IPC
        let serializedError;
        
        if (error.response) {
            // Server responded with error status
            serializedError = {
                success: false,
                message: error.message || `HTTP Error ${error.response.status}`,
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: {}
            };
            
            // Safely serialize headers
            try {
                if (error.response.headers) {
                    // Convert headers to plain object
                    serializedError.headers = JSON.parse(JSON.stringify(error.response.headers));
                }
            } catch (headerError) {
                console.warn('Failed to serialize response headers:', headerError);
                serializedError.headers = {};
            }
        } else if (error.request) {
            // Request was made but no response received
            serializedError = {
                success: false,
                message: "No response received from server.",
                status: null,
                statusText: null,
                data: null,
                headers: {}
            };
        } else {
            // Something else happened
            serializedError = {
                success: false,
                message: `Error setting up request: ${error.message}`,
                status: null,
                statusText: null,
                data: null,
                headers: {}
            };
        }
        
        console.error('Returning error result:', serializedError);
        // Return the error instead of throwing it
        return serializedError;
    }
});

ipcMain.handle('store:get', (event, key) => {
    return store.get(key);
});

ipcMain.handle('store:set', (event, key, value) => {
    store.set(key, value);
});

// OpenAPI Collection handlers
ipcMain.handle('import-openapi-file', async () => {
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
        const fileContent = await fs.readFile(filePath, 'utf8');
        
        let openApiSpec;
        if (filePath.endsWith('.json')) {
            openApiSpec = JSON.parse(fileContent);
        } else {
            openApiSpec = yaml.load(fileContent);
        }

        const collection = parseOpenApiToCollection(openApiSpec, path.basename(filePath));
        
        const collections = store.get('collections', []);
        collections.push(collection);
        store.set('collections', collections);

        return collection;
    } catch (error) {
        console.error('Error importing OpenAPI file:', error);
        throw error;
    }
});

function parseOpenApiToCollection(openApiSpec, fileName) {
    const collection = {
        id: Date.now().toString(),
        name: openApiSpec.info?.title || fileName,
        version: openApiSpec.info?.version || '1.0.0',
        baseUrl: '',
        endpoints: []
    };

    // Extract base URL from servers
    if (openApiSpec.servers && openApiSpec.servers.length > 0) {
        collection.baseUrl = openApiSpec.servers[0].url;
    }

    // Parse paths to create endpoints
    if (openApiSpec.paths) {
        for (const [pathKey, pathValue] of Object.entries(openApiSpec.paths)) {
            for (const [method, methodValue] of Object.entries(pathValue)) {
                if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
                    const endpoint = {
                        id: `${method.toUpperCase()}_${pathKey}`.replace(/[^a-zA-Z0-9]/g, '_'),
                        name: methodValue.summary || methodValue.operationId || `${method.toUpperCase()} ${pathKey}`,
                        method: method.toUpperCase(),
                        path: pathKey,
                        description: methodValue.description || '',
                        parameters: parseParameters(methodValue.parameters || []),
                        requestBody: parseRequestBody(methodValue.requestBody),
                        headers: {}
                    };

                    collection.endpoints.push(endpoint);
                }
            }
        }
    }

    return collection;
}

function parseParameters(parameters) {
    const parsed = {
        query: {},
        path: {},
        header: {}
    };

    parameters.forEach(param => {
        if (param.in === 'query') {
            parsed.query[param.name] = {
                required: param.required || false,
                type: param.schema?.type || 'string',
                description: param.description || '',
                example: param.example || param.schema?.example || ''
            };
        } else if (param.in === 'path') {
            parsed.path[param.name] = {
                required: true,
                type: param.schema?.type || 'string',
                description: param.description || '',
                example: param.example || param.schema?.example || ''
            };
        } else if (param.in === 'header') {
            parsed.header[param.name] = {
                required: param.required || false,
                type: param.schema?.type || 'string',
                description: param.description || '',
                example: param.example || param.schema?.example || ''
            };
        }
    });

    return parsed;
}

function parseRequestBody(requestBody) {
    if (!requestBody) return null;

    const content = requestBody.content;
    if (!content) return null;

    // Try to find JSON content first
    const jsonContent = content['application/json'];
    if (jsonContent && jsonContent.schema) {
        return {
            contentType: 'application/json',
            schema: jsonContent.schema,
            example: jsonContent.example || generateExampleFromSchema(jsonContent.schema)
        };
    }

    // Fallback to first available content type
    const firstContentType = Object.keys(content)[0];
    const firstContent = content[firstContentType];
    
    return {
        contentType: firstContentType,
        schema: firstContent.schema,
        example: firstContent.example || generateExampleFromSchema(firstContent.schema)
    };
}

function generateExampleFromSchema(schema) {
    if (!schema) return '';
    
    if (schema.example) return JSON.stringify(schema.example, null, 2);
    
    // Simple example generation for basic schemas
    if (schema.type === 'object' && schema.properties) {
        const example = {};
        for (const [key, value] of Object.entries(schema.properties)) {
            if (value.type === 'string') {
                example[key] = value.example || 'string';
            } else if (value.type === 'number') {
                example[key] = value.example || 0;
            } else if (value.type === 'boolean') {
                example[key] = value.example || false;
            } else if (value.type === 'array') {
                example[key] = [];
            } else {
                example[key] = null;
            }
        }
        return JSON.stringify(example, null, 2);
    }
    
    return '';
}