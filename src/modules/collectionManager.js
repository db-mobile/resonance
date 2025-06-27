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