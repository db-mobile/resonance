import { updateStatusDisplay } from './statusDisplay.js';

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
                <svg class="collections-empty-icon" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V8zm0 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" clip-rule="evenodd"></path>
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

    headerDiv.addEventListener('click', () => {
        div.classList.toggle('expanded');
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

export function loadEndpointIntoForm(collection, endpoint) {
    const urlInput = document.getElementById('url-input');
    const methodSelect = document.getElementById('method-select');
    const bodyInput = document.getElementById('body-input');
    const headersList = document.getElementById('headers-list');
    const queryParamsList = document.getElementById('query-params-list');

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

    // Populate request body
    if (endpoint.requestBody?.example) {
        bodyInput.value = endpoint.requestBody.example;
    } else {
        bodyInput.value = '';
    }

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