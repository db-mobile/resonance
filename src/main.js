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
let currentRequestController = null; // Track current request's AbortController

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
    let startTime = Date.now(); // Declare at function scope

    try {
        console.log('Received request options:', requestOptions);

        // Create a new AbortController for this request
        currentRequestController = new AbortController();

        // Get HTTP version settings
        const settings = store.get('settings', {});
        const httpVersion = settings.httpVersion || 'auto';

        // Prepare the axios config
        const axiosConfig = {
            method: requestOptions.method,
            url: requestOptions.url,
            headers: requestOptions.headers || {},
            timeout: 30000, // 30 second timeout
            signal: currentRequestController.signal, // Add abort signal
        };

        // Apply HTTP version configuration
        switch (httpVersion) {
            case 'http1':
                // Force HTTP/1.x
                axiosConfig.httpVersion = '1.1';
                axiosConfig.http2 = false;
                break;
            case 'http2':
                // Force HTTP/2
                axiosConfig.http2 = true;
                break;
            case 'auto':
            default:
                // Let axios/Node.js decide (default behavior)
                break;
        }

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

        startTime = Date.now(); // Reset timing just before request
        const response = await axios(axiosConfig);
        const ttfb = Date.now() - startTime;

        // Clear the controller on successful completion
        currentRequestController = null;

        // Return success result
        return {
            success: true,
            data: response.data,
            status: response.status,
            statusText: response.statusText,
            headers: JSON.parse(JSON.stringify(response.headers)),
            ttfb: ttfb
        };
    } catch (error) {
        console.error('API request error:', error);

        // Calculate TTFB even for errors
        const ttfb = Date.now() - startTime;

        // Clear the controller on error
        currentRequestController = null;

        // Create a serializable error object for IPC
        let serializedError;

        // Check if the error is due to cancellation
        if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
            return {
                success: false,
                message: "Request was cancelled",
                status: null,
                statusText: "Cancelled",
                data: null,
                headers: {},
                cancelled: true
            };
        }

        if (error.response) {
            // Server responded with error status
            serializedError = {
                success: false,
                message: error.message || `HTTP Error ${error.response.status}`,
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: {},
                ttfb: ttfb
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
                headers: {},
                ttfb: ttfb
            };
        } else {
            // Something else happened
            serializedError = {
                success: false,
                message: `Error setting up request: ${error.message}`,
                status: null,
                statusText: null,
                data: null,
                headers: {},
                ttfb: ttfb
            };
        }
        
        console.error('Returning error result:', serializedError);
        // Return the error instead of throwing it
        return serializedError;
    }
});

// --- IPC Handler for Cancelling Requests ---
ipcMain.handle('cancel-api-request', async (event) => {
    if (currentRequestController) {
        console.log('Cancelling current request...');
        currentRequestController.abort();
        currentRequestController = null;
        return { success: true, message: 'Request cancelled' };
    }
    return { success: false, message: 'No active request to cancel' };
});

ipcMain.handle('store:get', (event, key) => {
    return store.get(key);
});

ipcMain.handle('store:set', (event, key, value) => {
    store.set(key, value);
});

// Settings handlers
ipcMain.handle('settings:get', () => {
    return store.get('settings', {});
});

ipcMain.handle('settings:set', (event, settings) => {
    store.set('settings', settings);
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

        // Create baseUrl variable if a base URL was found
        if (collection.baseUrl) {
            const variables = store.get('collectionVariables', {});
            if (!variables[collection.id]) {
                variables[collection.id] = {};
            }
            variables[collection.id].baseUrl = collection.baseUrl;
            store.set('collectionVariables', variables);
        }

        return collection;
    } catch (error) {
        console.error('Error importing OpenAPI file:', error);
        throw error;
    }
});

function parseOpenApiToCollection(openApiSpec, fileName) {
    // Set the global spec for $ref resolution
    currentOpenApiSpec = openApiSpec;
    
    const collection = {
        id: Date.now().toString(),
        name: openApiSpec.info?.title || fileName,
        version: openApiSpec.info?.version || '1.0.0',
        baseUrl: '',
        defaultHeaders: {},
        endpoints: [],
        // Store the full spec for $ref resolution
        _openApiSpec: openApiSpec
    };

    // Extract base URL from servers
    if (openApiSpec.servers && openApiSpec.servers.length > 0) {
        collection.baseUrl = openApiSpec.servers[0].url;
    }

    // Extract default headers from components.headers or custom x-default-headers
    if (openApiSpec.components?.headers) {
        // Convert OpenAPI header components to simple key-value pairs
        for (const [headerName, headerSpec] of Object.entries(openApiSpec.components.headers)) {
            if (headerSpec.schema?.default || headerSpec.example) {
                collection.defaultHeaders[headerName] = headerSpec.schema?.default || headerSpec.example;
            }
        }
    }

    // Support custom x-default-headers extension
    if (openApiSpec['x-default-headers']) {
        Object.assign(collection.defaultHeaders, openApiSpec['x-default-headers']);
    }

    // Support default headers in info section
    if (openApiSpec.info?.['x-default-headers']) {
        Object.assign(collection.defaultHeaders, openApiSpec.info['x-default-headers']);
    }

    // Parse paths to create endpoints grouped by URL structure
    if (openApiSpec.paths) {
        const groupedEndpoints = {};
        
        // First pass: create endpoints and group them by base path
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

                    // Extract base path for grouping (first segment after leading slash)
                    const basePath = extractBasePath(pathKey);
                    
                    if (!groupedEndpoints[basePath]) {
                        groupedEndpoints[basePath] = [];
                    }
                    groupedEndpoints[basePath].push(endpoint);
                }
            }
        }
        
        // Second pass: create folder structure
        collection.folders = [];
        for (const [basePath, endpoints] of Object.entries(groupedEndpoints)) {
            const folder = {
                id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                name: basePath,
                endpoints: endpoints
            };
            collection.folders.push(folder);
        }
        
        // Keep backwards compatibility - flatten all endpoints
        collection.endpoints = Object.values(groupedEndpoints).flat();
    }

    return collection;
}

function extractBasePath(pathKey) {
    // Remove leading slash and extract first path segment
    const cleanPath = pathKey.replace(/^\//, '');
    const segments = cleanPath.split('/');
    
    // Return the first segment, or 'root' if no segments
    return segments[0] || 'root';
}

function parseParameters(parameters) {
    const parsed = {
        query: {},
        path: {},
        header: {}
    };

    parameters.forEach(param => {
        // Resolve $ref if present
        const resolvedParam = param.$ref ? resolveSchemaRef(param) : param;
        if (!resolvedParam) return; // Skip if $ref couldn't be resolved
        
        if (resolvedParam.in === 'query') {
            parsed.query[resolvedParam.name] = {
                required: resolvedParam.required || false,
                type: resolvedParam.schema?.type || 'string',
                description: resolvedParam.description || '',
                example: resolvedParam.example || resolvedParam.schema?.example || ''
            };
        } else if (resolvedParam.in === 'path') {
            parsed.path[resolvedParam.name] = {
                required: true,
                type: resolvedParam.schema?.type || 'string',
                description: resolvedParam.description || '',
                example: resolvedParam.example || resolvedParam.schema?.example || ''
            };
        } else if (resolvedParam.in === 'header') {
            // Generate sensible default examples for common headers
            let defaultExample = resolvedParam.example || resolvedParam.schema?.example || '';
            
            // Check for enum values in schema
            if (!defaultExample && resolvedParam.schema?.enum && resolvedParam.schema.enum.length > 0) {
                defaultExample = resolvedParam.schema.enum[0];
            }
            
            if (!defaultExample) {
                switch (resolvedParam.name.toLowerCase()) {
                    case 'accept-language':
                        defaultExample = 'en-US';
                        break;
                    case 'authorization':
                        defaultExample = 'Bearer {{ token }}';
                        break;
                    case 'content-type':
                        defaultExample = 'application/json';
                        break;
                    case 'accept':
                        defaultExample = 'application/json';
                        break;
                    case 'user-agent':
                        defaultExample = 'MyApp/1.0';
                        break;
                    case 'x-api-key':
                        defaultExample = '{{ apiKey }}';
                        break;
                    case 'x-api-version':
                        defaultExample = 'v1';
                        break;
                    default:
                        // Use parameter name as hint for meaningful defaults
                        if (param.name.toLowerCase().includes('token')) {
                            defaultExample = '{{ token }}';
                        } else if (param.name.toLowerCase().includes('key')) {
                            defaultExample = '{{ apiKey }}';
                        } else {
                            defaultExample = 'example-value';
                        }
                        break;
                }
            }
            
            parsed.header[resolvedParam.name] = {
                required: resolvedParam.required || false,
                type: resolvedParam.schema?.type || 'string',
                description: resolvedParam.description || '',
                example: defaultExample
            };
        }
    });

    return parsed;
}

// Global variable to store the current OpenAPI spec for $ref resolution
let currentOpenApiSpec = null;

function resolveSchemaRef(schemaOrRef, openApiSpec = null) {
    const spec = openApiSpec || currentOpenApiSpec;
    if (!schemaOrRef || !spec) {
        return schemaOrRef;
    }
    
    // If it's a $ref, resolve it
    if (schemaOrRef.$ref) {
        console.log('MAIN PROCESS: Resolving $ref:', schemaOrRef.$ref);
        
        // Parse the $ref path (e.g., "#/components/schemas/RestRefreshTokensRequest")
        const refPath = schemaOrRef.$ref.split('/').slice(1); // Remove the '#' part
        
        let resolved = spec;
        for (const part of refPath) {
            if (resolved && resolved[part]) {
                resolved = resolved[part];
            } else {
                console.log('MAIN PROCESS: Failed to resolve $ref path:', refPath, 'at part:', part);
                return schemaOrRef; // Return original if resolution fails
            }
        }
        
        console.log('MAIN PROCESS: Resolved $ref to:', resolved);
        
        // Recursively resolve any nested $refs
        return resolveSchemaRefs(resolved, spec);
    }
    
    // If it's not a $ref, return as is
    return schemaOrRef;
}

function resolveSchemaRefs(schema, openApiSpec = null) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }
    
    // If this schema has a $ref, resolve it first
    if (schema.$ref) {
        return resolveSchemaRef(schema, openApiSpec);
    }
    
    // Create a copy to avoid modifying the original
    const resolved = { ...schema };
    
    // Recursively resolve $refs in properties
    if (resolved.properties) {
        resolved.properties = { ...resolved.properties };
        for (const [key, prop] of Object.entries(resolved.properties)) {
            resolved.properties[key] = resolveSchemaRefs(prop, openApiSpec);
        }
    }
    
    // Recursively resolve $refs in array items
    if (resolved.items) {
        resolved.items = resolveSchemaRefs(resolved.items, openApiSpec);
    }
    
    // Handle allOf, oneOf, anyOf
    ['allOf', 'oneOf', 'anyOf'].forEach(key => {
        if (resolved[key] && Array.isArray(resolved[key])) {
            resolved[key] = resolved[key].map(item => resolveSchemaRefs(item, openApiSpec));
        }
    });
    
    return resolved;
}

function parseRequestBody(requestBody) {
    console.log('MAIN PROCESS: parseRequestBody called with:', requestBody);
    
    if (!requestBody) {
        console.log('MAIN PROCESS: No requestBody provided');
        return null;
    }

    const content = requestBody.content;
    if (!content) {
        console.log('MAIN PROCESS: No content in requestBody');
        return null;
    }

    // Check if request body is required
    const isRequired = requestBody.required === true;
    console.log('MAIN PROCESS: Request body required:', isRequired);

    // Try to find JSON content first
    const jsonContent = content['application/json'];
    console.log('MAIN PROCESS: JSON content found:', !!jsonContent);
    if (jsonContent) {
        console.log('MAIN PROCESS: JSON content schema:', jsonContent.schema);
        console.log('MAIN PROCESS: JSON content example:', jsonContent.example);
    }
    
    if (jsonContent && jsonContent.schema) {
        console.log('MAIN PROCESS: Resolving schema refs...');
        const resolvedSchema = resolveSchemaRefs(jsonContent.schema);
        console.log('MAIN PROCESS: Resolved schema:', resolvedSchema);
        
        console.log('MAIN PROCESS: Generating example from resolved schema...');
        const generatedExample = jsonContent.example || generateExampleFromSchema(resolvedSchema);
        console.log('MAIN PROCESS: Generated example result:', generatedExample);
        
        const finalResult = {
            contentType: 'application/json',
            schema: resolvedSchema, // Store the resolved schema
            required: isRequired,
            example: (generatedExample === null || generatedExample === undefined) ? 
                JSON.stringify({ "data": "example" }, null, 2) : generatedExample
        };
        
        console.log('MAIN PROCESS: Final requestBody result:', finalResult);
        return finalResult;
    }

    // Fallback to first available content type
    const firstContentType = Object.keys(content)[0];
    const firstContent = content[firstContentType];
    
    const resolvedSchema = resolveSchemaRefs(firstContent.schema);
    const generatedExample = firstContent.example || generateExampleFromSchema(resolvedSchema);
    
    return {
        contentType: firstContentType,
        schema: resolvedSchema,
        required: isRequired,
        example: (generatedExample === null || generatedExample === undefined) ? 
            JSON.stringify({ "data": "example" }, null, 2) : generatedExample
    };
}

function generateExampleFromSchema(schema, depth = 0) {
    console.log(`MAIN PROCESS: [Depth ${depth}] generateExampleFromSchema called with:`, schema);
    
    if (!schema) {
        console.log('MAIN PROCESS: No schema, returning basic template');
        return JSON.stringify({ "data": "example" }, null, 2);
    }
    
    if (schema.example !== undefined && schema.example !== null) {
        console.log('MAIN PROCESS: Schema has example, using it:', schema.example);
        if (depth === 0) {
            return JSON.stringify(schema.example, null, 2);
        }
        return schema.example;
    }
    
    console.log(`MAIN PROCESS: [Depth ${depth}] Schema type:`, schema.type);
    console.log(`MAIN PROCESS: [Depth ${depth}] Schema properties:`, schema.properties);
    
    // Recursive function to generate example from schema
    function generateValue(propSchema, propName = '', currentDepth = 0) {
        console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generating value for property "${propName}" with schema:`, propSchema);
        
        if (!propSchema) {
            console.log(`MAIN PROCESS: [Depth ${currentDepth}] No propSchema for ${propName}`);
            return 'no-schema';
        }
        
        // Handle $ref if present
        if (propSchema.$ref) {
            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Found $ref, resolving:`, propSchema.$ref);
            const resolved = resolveSchemaRef(propSchema);
            if (resolved && resolved !== propSchema) {
                return generateValue(resolved, propName, currentDepth);
            }
            return 'ref-placeholder';
        }
        
        // If schema has properties but no type, assume it's an object
        if (propSchema.properties && !propSchema.type) {
            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Schema has properties but no type, assuming object for ${propName}`);
            propSchema = { ...propSchema, type: 'object' };
        }
        
        if (propSchema.example !== undefined && propSchema.example !== null) {
            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Using example for ${propName}:`, propSchema.example);
            return propSchema.example;
        }
        
        if (propSchema.default !== undefined) {
            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Using default for ${propName}:`, propSchema.default);
            return propSchema.default;
        }
        
        console.log(`MAIN PROCESS: [Depth ${currentDepth}] Property ${propName} has type:`, propSchema.type);
        
        switch (propSchema.type) {
            case 'string':
                if (propSchema.format === 'email') return 'user@example.com';
                if (propSchema.format === 'date') return '2024-01-01';
                if (propSchema.format === 'date-time') return '2024-01-01T12:00:00Z';
                if (propSchema.format === 'uuid') return '123e4567-e89b-12d3-a456-426614174000';
                if (propSchema.enum) return propSchema.enum[0];
                
                // Generate more realistic and varied sample strings
                const sampleStrings = [
                    'nisi', 'est magna Excepteur ipsum', 'officia', 'dolor ea adipisicing cillum',
                    'Lorem ipsum', 'consectetur', 'adipiscing elit', 'sed do eiusmod',
                    'tempor incididunt', 'labore et dolore', 'magna aliqua'
                ];
                
                const name = propName.toLowerCase();
                if (name.includes('name')) return 'Example Name';
                if (name.includes('title')) return 'Example Title';
                if (name.includes('description')) return 'Example description text';
                if (name.includes('id')) return 'example-id-123';
                if (name.includes('email')) return 'user@example.com';
                if (name.includes('password')) return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
                if (name.includes('newpassword')) return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
                if (name.includes('confirmpassword')) return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
                if (name.includes('type')) return sampleStrings[0]; // Use first sample for type fields
                if (name.includes('phone')) return '+1-555-0123';
                if (name.includes('address')) return '123 Main Street';
                if (name.includes('city')) return 'New York';
                if (name.includes('country')) return 'United States';
                if (name.includes('token')) return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
                if (name.includes('url')) return 'https://example.com';
                if (name.includes('code')) return 'ABC123';
                
                // Return a varied sample string
                return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
                
            case 'number':
            case 'integer':
                if (propSchema.minimum !== undefined) return propSchema.minimum;
                if (propSchema.maximum !== undefined && propSchema.minimum !== undefined) {
                    return Math.floor((propSchema.minimum + propSchema.maximum) / 2);
                }
                if (propSchema.enum) return propSchema.enum[0];
                if (propName.toLowerCase().includes('id')) return 1;
                if (propName.toLowerCase().includes('count')) return 10;
                if (propName.toLowerCase().includes('price')) return 99.99;
                if (propName.toLowerCase().includes('age')) return 25;
                return propSchema.type === 'integer' ? 42 : 42.5;
                
            case 'boolean':
                return false;
                
            case 'array':
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generating array for ${propName}, items schema:`, propSchema.items);
                if (propSchema.items) {
                    const itemExample = generateValue(propSchema.items, propName + '_item', currentDepth + 1);
                    console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generated array item:`, itemExample);
                    return [itemExample];
                }
                return [];
                
            case 'object':
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generating object for ${propName}, properties:`, propSchema.properties);
                if (propSchema.properties) {
                    const obj = {};
                    for (const [key, valueProp] of Object.entries(propSchema.properties)) {
                        console.log(`MAIN PROCESS: [Depth ${currentDepth}] Processing object property ${key}:`, valueProp);
                        obj[key] = generateValue(valueProp, key, currentDepth + 1);
                    }
                    console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generated object for ${propName}:`, obj);
                    return obj;
                }
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] No properties for object ${propName}, returning empty object`);
                return {};
                
            default:
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Unknown type for ${propName}:`, propSchema.type);
                return 'unknown-type';
        }
    }
    
    // Generate example based on schema type
    let example;
    
    console.log(`MAIN PROCESS: [Depth ${depth}] Root schema processing...`);
    if (schema.type === 'object' && schema.properties) {
        console.log(`MAIN PROCESS: [Depth ${depth}] Processing object schema with properties:`, Object.keys(schema.properties));
        example = generateValue(schema, 'root', depth);
    } else if (schema.properties && !schema.type) {
        // Schema has properties but no explicit type - assume object
        console.log(`MAIN PROCESS: [Depth ${depth}] Processing schema with properties but no type, assuming object:`, Object.keys(schema.properties));
        schema.type = 'object'; // Set type for generateValue
        example = generateValue(schema, 'root', depth);
    } else if (schema.type === 'array') {
        console.log(`MAIN PROCESS: [Depth ${depth}] Processing array schema`);
        example = generateValue(schema, 'root', depth);
    } else if (schema.type) {
        console.log(`MAIN PROCESS: [Depth ${depth}] Processing schema with type:`, schema.type);
        example = generateValue(schema, 'root', depth);
    } else {
        console.log(`MAIN PROCESS: [Depth ${depth}] No type or properties found, returning null for better fallback handling`);
        return null;
    }
    
    // Ensure we never return null or undefined
    if (example === null || example === undefined) {
        example = { "data": "example" };
    }
    
    console.log(`MAIN PROCESS: [Depth ${depth}] Final generated example:`, example);
    
    // Return properly formatted JSON only at the top level
    if (depth === 0) {
        if (typeof example === 'string') {
            return example;
        } else {
            const result = JSON.stringify(example, null, 2);
            console.log(`MAIN PROCESS: [Depth ${depth}] Returning JSON result:`, result);
            return result;
        }
    } else {
        return example;
    }
}