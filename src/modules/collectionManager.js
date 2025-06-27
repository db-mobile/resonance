import { updateStatusDisplay } from './statusDisplay.js';

// Track original body values to detect user modifications
let originalBodyValues = new Map();

export async function loadCollections() {
    try {
        const collections = await window.electronAPI.store.get('collections') || [];
        displayCollections(collections);
        return collections;
    } catch (error) {
        console.error('Error loading collections:', error);
        updateStatusDisplay('Error loading collections', null);
        return [];
    }
}

export function displayCollections(collections) {
    const collectionsDiv = document.getElementById('collections-list');
    if (!collectionsDiv) return;

    if (collections.length === 0) {
        collectionsDiv.innerHTML = `
            <div class="collections-empty">
                <svg class="collections-empty-icon" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L13.09 7.26L18 6L16.74 11.09L22 12L16.74 12.91L18 18L13.09 16.74L12 22L10.91 16.74L6 18L7.26 12.91L2 12L7.26 11.09L6 6L10.91 7.26L12 2Z"/>
                </svg>
                <p class="collections-empty-text">No collections imported yet</p>
                <p class="collections-empty-subtext">Import an OpenAPI collection to get started</p>
            </div>
        `;
        return;
    }

    collectionsDiv.innerHTML = '';
    collections.forEach(collection => {
        const collectionElement = createCollectionElement(collection);
        collectionsDiv.appendChild(collectionElement);
    });
}

function createCollectionElement(collection) {
    const div = document.createElement('div');
    div.className = 'collection-item';
    div.dataset.collectionId = collection.id;

    const headerDiv = document.createElement('div');
    headerDiv.className = 'collection-header';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'collection-name';
    nameDiv.textContent = collection.name;

    const toggleDiv = document.createElement('div');
    toggleDiv.className = 'collection-toggle';
    toggleDiv.innerHTML = '▼';

    headerDiv.appendChild(nameDiv);
    headerDiv.appendChild(toggleDiv);

    const endpointsDiv = document.createElement('div');
    endpointsDiv.className = 'collection-endpoints';

    collection.endpoints.forEach(endpoint => {
        const endpointDiv = document.createElement('div');
        endpointDiv.className = 'endpoint-item';
        endpointDiv.dataset.endpointId = endpoint.id;
        endpointDiv.dataset.collectionId = collection.id;

        const methodSpan = document.createElement('span');
        methodSpan.className = `endpoint-method ${endpoint.method.toLowerCase()}`;
        methodSpan.textContent = endpoint.method;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'endpoint-path';
        pathSpan.textContent = endpoint.path;

        endpointDiv.appendChild(methodSpan);
        endpointDiv.appendChild(pathSpan);

        endpointDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            loadEndpointIntoForm(collection, endpoint);
        });

        endpointsDiv.appendChild(endpointDiv);
    });

    div.appendChild(headerDiv);
    div.appendChild(endpointsDiv);

    headerDiv.addEventListener('click', (e) => {
        if (e.target.closest('.context-menu')) {
            return; // Don't toggle if clicking on context menu
        }
        
        // Close all other expanded collections first
        const allCollections = document.querySelectorAll('.collection-item');
        allCollections.forEach(item => {
            if (item !== div) {
                item.classList.remove('expanded');
            }
        });
        
        // Toggle this collection
        div.classList.toggle('expanded');
    });

    // Add context menu functionality
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e, collection);
    });

    return div;
}

function getMethodColor(method) {
    const colors = {
        'GET': '#28a745',
        'POST': '#007bff',
        'PUT': '#ffc107',
        'DELETE': '#dc3545',
        'PATCH': '#6f42c1',
        'HEAD': '#6c757d',
        'OPTIONS': '#17a2b8'
    };
    return colors[method] || '#6c757d';
}

// Store reference to current collection's OpenAPI spec for $ref resolution
let currentOpenApiSpec = null;

function resolveSchemaRef(schemaOrRef, openApiSpec = null) {
    const spec = openApiSpec || currentOpenApiSpec;
    if (!schemaOrRef || !spec) {
        return schemaOrRef;
    }
    
    // If it's a $ref, resolve it
    if (schemaOrRef.$ref) {
        console.log('Resolving $ref:', schemaOrRef.$ref);
        
        // Parse the $ref path (e.g., "#/components/schemas/RestRefreshTokensRequest")
        const refPath = schemaOrRef.$ref.split('/').slice(1); // Remove the '#' part
        
        let resolved = spec;
        for (const part of refPath) {
            if (resolved && resolved[part]) {
                resolved = resolved[part];
            } else {
                console.log('Failed to resolve $ref path:', refPath, 'at part:', part);
                return schemaOrRef; // Return original if resolution fails
            }
        }
        
        console.log('Resolved $ref to:', resolved);
        
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

export async function loadEndpointIntoForm(collection, endpoint) {
    // Set the OpenAPI spec for $ref resolution
    currentOpenApiSpec = collection._openApiSpec;
    
    const urlInput = document.getElementById('url-input');
    const methodSelect = document.getElementById('method-select');
    const bodyInput = document.getElementById('body-input');
    const headersList = document.getElementById('headers-list');
    const queryParamsList = document.getElementById('query-params-list');

    // Check if elements exist
    if (!bodyInput) {
        console.error('Body input element not found!');
        return;
    }

    // Store current endpoint info for persistence
    if (window.currentEndpoint) {
        await saveRequestBodyModification(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
    }
    window.currentEndpoint = { collectionId: collection.id, endpointId: endpoint.id };

    // Build full URL
    let fullUrl = endpoint.path;
    if (collection.baseUrl) {
        fullUrl = collection.baseUrl.replace(/\/$/, '') + endpoint.path;
    }

    // Replace path parameters with example values or placeholders
    if (endpoint.parameters?.path) {
        Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
            const placeholder = param.example || `{${key}}`;
            fullUrl = fullUrl.replace(`{${key}}`, placeholder);
        });
    }

    urlInput.value = fullUrl;
    methodSelect.value = endpoint.method;

    // Clear existing key-value pairs
    clearKeyValueList(headersList);
    clearKeyValueList(queryParamsList);

    // Populate headers
    if (endpoint.parameters?.header) {
        Object.entries(endpoint.parameters.header).forEach(([key, param]) => {
            addKeyValueRow(headersList, key, param.example || '');
        });
    }

    // Add default Content-Type for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        const contentType = endpoint.requestBody?.contentType || 'application/json';
        addKeyValueRow(headersList, 'Content-Type', contentType);
    }

    // Populate query parameters
    if (endpoint.parameters?.query) {
        Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
            addKeyValueRow(queryParamsList, key, param.example || '');
        });
    }

    // Check for persisted user modifications first
    const persistedBody = await getPersistedRequestBody(collection.id, endpoint.id);
    
    if (persistedBody) {
        // Use persisted user-modified body
        console.log('Using persisted user-modified body');
        bodyInput.value = persistedBody;
    } else {
        // DEBUG: Log the full endpoint structure to understand what we're working with
        console.log('=== FULL ENDPOINT DEBUG ===');
        console.log('Collection:', collection);
        console.log('Endpoint:', endpoint);
        console.log('Endpoint.requestBody full structure:', JSON.stringify(endpoint.requestBody, null, 2));
        console.log('=== END FULL ENDPOINT DEBUG ===');
        // Populate request body with generated examples
        console.log('=== REQUEST BODY POPULATION ===');
        console.log('Method:', endpoint.method);
        console.log('Has requestBody:', !!endpoint.requestBody);
        if (endpoint.requestBody) {
            console.log('RequestBody structure:', endpoint.requestBody);
            console.log('Has example:', !!endpoint.requestBody.example);
            console.log('Example value:', endpoint.requestBody.example);
            console.log('Is required:', endpoint.requestBody.required);
            console.log('Has schema:', !!endpoint.requestBody.schema);
            if (endpoint.requestBody.schema) {
                console.log('Schema structure:', endpoint.requestBody.schema);
            }
        }
        
        if (endpoint.requestBody) {
            if (endpoint.requestBody.example && endpoint.requestBody.example !== null && endpoint.requestBody.example !== 'null') {
                // Use the example if available and not null
                console.log('Using existing example');
                bodyInput.value = endpoint.requestBody.example;
            } else {
                // Try to generate from schema regardless of whether it's required
                console.log('Generating body from schema');
                const placeholder = generatePlaceholderBody(endpoint.requestBody);
                if (placeholder && placeholder !== 'null' && placeholder !== null && placeholder !== undefined) {
                    bodyInput.value = placeholder;
                } else if (endpoint.requestBody.required) {
                    // Fallback for required body if schema generation fails
                    console.log('Using fallback for failed required body');
                    bodyInput.value = JSON.stringify({
                        "note": "Request body is required",
                        "data": "Please fill in the required fields"
                    }, null, 2);
                } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
                    // Final fallback for POST/PUT/PATCH methods
                    console.log('Using basic template for POST/PUT/PATCH - schema generation failed');
                    bodyInput.value = JSON.stringify({
                        "data": "example"
                    }, null, 2);
                } else {
                    console.log('Clearing body - no schema and not required');
                    bodyInput.value = '';
                }
            }
        } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            // For methods that typically have bodies but no requestBody spec, provide a basic template
            console.log('No requestBody spec, using basic template');
            bodyInput.value = JSON.stringify({
                "data": "example"
            }, null, 2);
        } else {
            console.log('No request body needed');
            bodyInput.value = '';
        }
        
        console.log('Final body value:', bodyInput.value);
        console.log('=== END REQUEST BODY POPULATION ===');
    }

    // Store the original body value for modification tracking
    const key = `${collection.id}_${endpoint.id}`;
    originalBodyValues.set(key, bodyInput.value);

    // Ensure at least one empty row in lists
    if (headersList.children.length === 0) {
        addKeyValueRow(headersList);
    }
    if (queryParamsList.children.length === 0) {
        addKeyValueRow(queryParamsList);
    }

    updateStatusDisplay(`Loaded endpoint: ${endpoint.name}`, null);
}

function clearKeyValueList(container) {
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
}

function addKeyValueRow(container, key = '', value = '') {
    const row = document.createElement('div');
    row.className = 'key-value-row';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'key-input';
    keyInput.placeholder = 'Key';
    keyInput.value = key;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'value-input';
    valueInput.placeholder = 'Value';
    valueInput.value = value;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn remove-row-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
        row.remove();
    });

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);

    container.appendChild(row);
}

function generatePlaceholderBody(requestBody) {
    console.log('generatePlaceholderBody called with:', requestBody);
    
    if (!requestBody) {
        console.log('No requestBody provided');
        return null;
    }
    
    if (!requestBody.schema) {
        console.log('No schema in requestBody');
        return null;
    }

    console.log('Resolving schema refs...');
    const resolvedSchema = resolveSchemaRefs(requestBody.schema);
    console.log('Resolved schema:', resolvedSchema);

    console.log('Calling generateExampleFromSchema with resolved schema:', resolvedSchema);
    const result = generateExampleFromSchema(resolvedSchema);
    console.log('generateExampleFromSchema returned:', result);
    
    // Ensure we never return null, undefined, or the string "null"
    if (!result || result === 'null' || result === null || result === undefined) {
        console.log('Schema generation failed, result was:', result);
        return null;
    }
    
    return result;
}

function generateExampleFromSchema(schema, depth = 0) {
    console.log(`[Depth ${depth}] generateExampleFromSchema called with schema:`, schema);
    
    if (!schema) {
        console.log('No schema provided, returning basic template');
        return JSON.stringify({ "data": "example" }, null, 2);
    }
    
    if (schema.example !== undefined && schema.example !== null) {
        console.log('Schema has example, using it:', schema.example);
        if (depth === 0) {
            return JSON.stringify(schema.example, null, 2);
        }
        return schema.example;
    }
    
    console.log(`[Depth ${depth}] Schema type:`, schema.type);
    console.log(`[Depth ${depth}] Schema properties:`, schema.properties);
    
    // Recursive function to generate example from schema
    function generateValue(propSchema, propName = '', currentDepth = 0) {
        console.log(`[Depth ${currentDepth}] Generating value for property "${propName}" with schema:`, propSchema);
        
        if (!propSchema) {
            console.log(`[Depth ${currentDepth}] No propSchema for ${propName}`);
            return 'no-schema';
        }
        
        // Handle $ref if present
        if (propSchema.$ref) {
            console.log(`[Depth ${currentDepth}] Found $ref, resolving:`, propSchema.$ref);
            const resolved = resolveSchemaRef(propSchema);
            if (resolved && resolved !== propSchema) {
                return generateValue(resolved, propName, currentDepth);
            }
            return 'ref-placeholder';
        }
        
        // If schema has properties but no type, assume it's an object
        if (propSchema.properties && !propSchema.type) {
            console.log(`[Depth ${currentDepth}] Schema has properties but no type, assuming object for ${propName}`);
            propSchema = { ...propSchema, type: 'object' };
        }
        
        if (propSchema.example !== undefined && propSchema.example !== null) {
            console.log(`[Depth ${currentDepth}] Using example for ${propName}:`, propSchema.example);
            return propSchema.example;
        }
        
        if (propSchema.default !== undefined) {
            console.log(`[Depth ${currentDepth}] Using default for ${propName}:`, propSchema.default);
            return propSchema.default;
        }
        
        console.log(`[Depth ${currentDepth}] Property ${propName} has type:`, propSchema.type);
        
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
                console.log(`[Depth ${currentDepth}] Generating array for ${propName}, items schema:`, propSchema.items);
                if (propSchema.items) {
                    const itemExample = generateValue(propSchema.items, propName + '_item', currentDepth + 1);
                    console.log(`[Depth ${currentDepth}] Generated array item:`, itemExample);
                    return [itemExample];
                }
                return [];
                
            case 'object':
                console.log(`[Depth ${currentDepth}] Generating object for ${propName}, properties:`, propSchema.properties);
                if (propSchema.properties) {
                    const obj = {};
                    for (const [key, valueProp] of Object.entries(propSchema.properties)) {
                        console.log(`[Depth ${currentDepth}] Processing object property ${key}:`, valueProp);
                        obj[key] = generateValue(valueProp, key, currentDepth + 1);
                    }
                    console.log(`[Depth ${currentDepth}] Generated object for ${propName}:`, obj);
                    return obj;
                }
                console.log(`[Depth ${currentDepth}] No properties for object ${propName}, returning empty object`);
                return {};
                
            default:
                console.log(`[Depth ${currentDepth}] Unknown type for ${propName}:`, propSchema.type);
                return 'unknown-type';
        }
    }
    
    // Generate example based on schema type
    let example;
    
    console.log(`[Depth ${depth}] Root schema processing...`);
    if (schema.type === 'object' && schema.properties) {
        console.log(`[Depth ${depth}] Processing object schema with properties:`, Object.keys(schema.properties));
        example = generateValue(schema, 'root', depth);
    } else if (schema.properties && !schema.type) {
        // Schema has properties but no explicit type - assume object
        console.log(`[Depth ${depth}] Processing schema with properties but no type, assuming object:`, Object.keys(schema.properties));
        schema.type = 'object'; // Set type for generateValue
        example = generateValue(schema, 'root', depth);
    } else if (schema.type === 'array') {
        console.log(`[Depth ${depth}] Processing array schema`);
        example = generateValue(schema, 'root', depth);
    } else if (schema.type) {
        console.log(`[Depth ${depth}] Processing schema with type:`, schema.type);
        example = generateValue(schema, 'root', depth);
    } else {
        console.log(`[Depth ${depth}] No type or properties found, returning null for better fallback handling`);
        return null;
    }
    
    // Ensure we never return null or undefined
    if (example === null || example === undefined) {
        example = { "data": "example" };
    }
    
    console.log(`[Depth ${depth}] Final generated example:`, example);
    
    // Return properly formatted JSON only at the top level
    if (depth === 0) {
        if (typeof example === 'string') {
            return example;
        } else {
            const jsonResult = JSON.stringify(example, null, 2);
            console.log(`[Depth ${depth}] Returning JSON example:`, jsonResult);
            return jsonResult;
        }
    } else {
        return example;
    }
}

// Context menu functionality
let currentContextMenu = null;

function showContextMenu(event, collection) {
    // Remove any existing context menu
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.style.zIndex = '1000';

    // Rename option
    const renameItem = document.createElement('div');
    renameItem.className = 'context-menu-item';
    renameItem.innerHTML = `
        <svg class="context-menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18.5 2.50023C18.8978 2.10243 19.4374 1.87891 20 1.87891C20.5626 1.87891 21.1022 2.10243 21.5 2.50023C21.8978 2.89804 22.1213 3.43762 22.1213 4.00023C22.1213 4.56284 21.8978 5.10243 21.5 5.50023L12 15.0002L8 16.0002L9 12.0002L18.5 2.50023Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Rename Collection
    `;

    renameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        showRenameDialog(collection);
    });

    // Delete option
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item context-menu-delete';
    deleteItem.innerHTML = `
        <svg class="context-menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Delete Collection
    `;

    deleteItem.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        confirmDeleteCollection(collection);
    });

    menu.appendChild(renameItem);
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    currentContextMenu = menu;

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${event.clientX - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${event.clientY - rect.height}px`;
    }

    // Close menu when clicking elsewhere
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
        document.addEventListener('contextmenu', hideContextMenu, { once: true });
    }, 0);
}

function hideContextMenu() {
    if (currentContextMenu) {
        currentContextMenu.remove();
        currentContextMenu = null;
    }
}

function confirmDeleteCollection(collection) {
    const confirmed = confirm(`Are you sure you want to delete the collection "${collection.name}"?\n\nThis action cannot be undone.`);
    
    if (confirmed) {
        deleteCollection(collection.id);
    }
}

async function deleteCollection(collectionId) {
    try {
        updateStatusDisplay('Deleting collection...', null);
        
        // Get current collections
        const collections = await window.electronAPI.store.get('collections') || [];
        
        // Filter out the collection to delete
        const updatedCollections = collections.filter(collection => collection.id !== collectionId);
        
        // Save updated collections
        await window.electronAPI.store.set('collections', updatedCollections);
        
        // Refresh the display
        await loadCollections();
        
        updateStatusDisplay('Collection deleted successfully', null);
    } catch (error) {
        console.error('Error deleting collection:', error);
        updateStatusDisplay(`Error deleting collection: ${error.message}`, null);
    }
}

// Rename collection functionality
function showRenameDialog(collection) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'rename-dialog-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'rename-dialog';
    dialog.style.cssText = `
        background: var(--bg-color, #ffffff);
        border-radius: 8px;
        padding: 24px;
        min-width: 400px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        border: 1px solid var(--border-color, #e0e0e0);
    `;

    // Create dialog content
    dialog.innerHTML = `
        <h3 style="margin: 0 0 16px 0; color: var(--text-color, #333333);">Rename Collection</h3>
        <div style="margin-bottom: 16px;">
            <label for="collection-name-input" style="display: block; margin-bottom: 8px; color: var(--text-color, #333333); font-weight: 500;">Collection Name:</label>
            <input type="text" id="collection-name-input" value="${collection.name}" 
                   style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #e0e0e0); border-radius: 4px; font-size: 14px; box-sizing: border-box;">
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="rename-cancel-btn" style="padding: 8px 16px; border: 1px solid var(--border-color, #e0e0e0); background: transparent; border-radius: 4px; cursor: pointer;">Cancel</button>
            <button id="rename-confirm-btn" style="padding: 8px 16px; border: none; background: var(--primary-color, #007bff); color: white; border-radius: 4px; cursor: pointer;">Rename</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Get references to elements
    const nameInput = dialog.querySelector('#collection-name-input');
    const cancelBtn = dialog.querySelector('#rename-cancel-btn');
    const confirmBtn = dialog.querySelector('#rename-confirm-btn');

    // Focus and select the input text
    nameInput.focus();
    nameInput.select();

    // Close dialog function
    function closeDialog() {
        overlay.remove();
    }

    // Event listeners
    cancelBtn.addEventListener('click', closeDialog);
    
    confirmBtn.addEventListener('click', async () => {
        const newName = nameInput.value.trim();
        if (newName && newName !== collection.name) {
            await renameCollection(collection.id, newName);
        }
        closeDialog();
    });

    // Handle Enter key to confirm
    nameInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const newName = nameInput.value.trim();
            if (newName && newName !== collection.name) {
                await renameCollection(collection.id, newName);
            }
            closeDialog();
        } else if (e.key === 'Escape') {
            closeDialog();
        }
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeDialog();
        }
    });
}

async function renameCollection(collectionId, newName) {
    try {
        updateStatusDisplay('Renaming collection...', null);
        
        // Get current collections
        const collections = await window.electronAPI.store.get('collections') || [];
        
        // Find and update the collection
        const updatedCollections = collections.map(collection => {
            if (collection.id === collectionId) {
                return { ...collection, name: newName };
            }
            return collection;
        });
        
        // Save updated collections
        await window.electronAPI.store.set('collections', updatedCollections);
        
        // Refresh the display
        await loadCollections();
        
        updateStatusDisplay(`Collection renamed to "${newName}"`, null);
    } catch (error) {
        console.error('Error renaming collection:', error);
        updateStatusDisplay(`Error renaming collection: ${error.message}`, null);
    }
}

export async function importOpenApiFile() {
    try {
        updateStatusDisplay('Importing OpenAPI file...', null);
        
        const collection = await window.electronAPI.collections.importOpenApiFile();
        
        if (collection) {
            updateStatusDisplay(`Imported collection: ${collection.name}`, null);
            await loadCollections(); // Refresh the collections display
            return collection;
        } else {
            updateStatusDisplay('Import cancelled', null);
            return null;
        }
    } catch (error) {
        console.error('Error importing collection:', error);
        updateStatusDisplay(`Import error: ${error.message}`, null);
        throw error;
    }
}

// Persistence functions for user-modified request bodies
async function getPersistedRequestBody(collectionId, endpointId) {
    try {
        const modifiedBodies = await window.electronAPI.store.get('modifiedRequestBodies') || {};
        const key = `${collectionId}_${endpointId}`;
        return modifiedBodies[key] || null;
    } catch (error) {
        console.error('Error getting persisted request body:', error);
        return null;
    }
}

export async function saveRequestBodyModification(collectionId, endpointId) {
    try {
        const bodyInput = document.getElementById('body-input');
        if (!bodyInput || !bodyInput.value.trim()) {
            return;
        }

        const currentBody = bodyInput.value.trim();
        const key = `${collectionId}_${endpointId}`;
        const originalBody = originalBodyValues.get(key);

        // Only save if the body was modified from the original
        if (originalBody && currentBody !== originalBody) {
            const modifiedBodies = await window.electronAPI.store.get('modifiedRequestBodies') || {};
            modifiedBodies[key] = currentBody;
            await window.electronAPI.store.set('modifiedRequestBodies', modifiedBodies);
            console.log('Saved modified request body for endpoint:', endpointId);
        }
    } catch (error) {
        console.error('Error saving request body modification:', error);
    }
}

// Initialize body tracking when module loads
export function initializeBodyTracking() {
    const bodyInput = document.getElementById('body-input');
    if (bodyInput) {
        // Save body modifications when user navigates away or sends request
        bodyInput.addEventListener('blur', async () => {
            if (window.currentEndpoint) {
                await saveRequestBodyModification(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
            }
        });

        // Auto-save periodically during typing (debounced)
        let saveTimeout;
        bodyInput.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (window.currentEndpoint) {
                    await saveRequestBodyModification(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
                }
            }, 2000); // Save 2 seconds after user stops typing
        });
    }
}