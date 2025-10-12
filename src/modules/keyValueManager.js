import { pathParamsList, addPathParamBtn, headersList, addHeaderBtn, queryParamsList, addQueryParamBtn, urlInput } from './domElements.js';

export function createKeyValueRow(key = '', value = '') {
    const row = document.createElement('div');
    row.classList.add('key-value-row');

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.classList.add('key-input');
    keyInput.placeholder = 'Key';
    keyInput.value = key;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.classList.add('value-input');
    valueInput.placeholder = 'Value';
    valueInput.value = value;

    const removeButton = document.createElement('button');
    removeButton.classList.add('remove-btn', 'remove-row-btn');
    removeButton.textContent = 'Remove';
    // Event listener for remove button will be handled in renderer.js for simplicity

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeButton);

    return row;
}

export function addKeyValueRow(listContainer, key = '', value = '') {
    const newRow = createKeyValueRow(key, value);
    listContainer.appendChild(newRow);
}

export function parseKeyValuePairs(listContainer) {
    const result = {};
    const rows = listContainer.querySelectorAll('.key-value-row');
    rows.forEach(row => {
        const keyInput = row.querySelector('.key-input');
        const valueInput = row.querySelector('.value-input');
        const key = keyInput.value.trim();
        const value = valueInput.value.trim();

        if (key) {
            result[key] = value;
        }
    });
    return result;
}

// URL and query parameters synchronization functions
export function updateUrlFromQueryParams() {
    try {
        const queryParams = parseKeyValuePairs(queryParamsList);
        let urlString = urlInput.value.trim();

        if (!urlString) {
            return;
        }

        // Split URL into base and query string parts
        const questionMarkIndex = urlString.indexOf('?');
        const baseUrl = questionMarkIndex >= 0 ? urlString.substring(0, questionMarkIndex) : urlString;

        // Build new query string from query params
        const params = new URLSearchParams();
        Object.entries(queryParams).forEach(([key, value]) => {
            if (key) {
                params.set(key, value);
            }
        });

        const queryString = params.toString();
        urlInput.value = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    } catch (error) {
        console.error('Error updating URL from query params:', error);
    }
}

export function updateQueryParamsFromUrl() {
    try {
        let urlString = urlInput.value.trim();

        if (!urlString) {
            queryParamsList.innerHTML = '';
            addKeyValueRow(queryParamsList);
            return;
        }

        // Extract query string from URL (works with template variables)
        const questionMarkIndex = urlString.indexOf('?');

        // Clear existing query param rows
        queryParamsList.innerHTML = '';

        if (questionMarkIndex >= 0) {
            const queryString = urlString.substring(questionMarkIndex + 1);
            const params = new URLSearchParams(queryString);

            // Add rows for each URL query parameter
            if (params.toString()) {
                params.forEach((value, key) => {
                    addKeyValueRow(queryParamsList, key, value);
                });
            } else {
                addKeyValueRow(queryParamsList);
            }
        } else {
            // No query parameters in URL
            addKeyValueRow(queryParamsList);
        }
    } catch (error) {
        console.error('Error updating query params from URL:', error);
        // If there's an error, just ensure we have at least one empty row
        if (queryParamsList.children.length === 0) {
            addKeyValueRow(queryParamsList);
        }
    }
}

export function initKeyValueListeners() {
    addPathParamBtn.addEventListener('click', () => addKeyValueRow(pathParamsList));
    addHeaderBtn.addEventListener('click', () => addKeyValueRow(headersList));
    addQueryParamBtn.addEventListener('click', () => addKeyValueRow(queryParamsList));

    // URL input change listener
    urlInput.addEventListener('input', updateQueryParamsFromUrl);
    urlInput.addEventListener('blur', updateQueryParamsFromUrl);

    // Path params input listeners (using event delegation)
    pathParamsList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            debounceAutoSave(() => autoSavePathParams());
        }
    });

    // Query params input listeners (using event delegation)
    queryParamsList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            updateUrlFromQueryParams();
            debounceAutoSave(() => autoSaveQueryParams());
        }
    });

    // Headers input listeners (using event delegation)
    headersList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            debounceAutoSave(() => autoSaveHeaders());
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-row-btn')) {
            const isPathParam = event.target.closest('#path-params-list');
            const isQueryParam = event.target.closest('#query-params-list');
            const isHeader = event.target.closest('#headers-list');
            event.target.closest('.key-value-row').remove();

            // Auto-save path params if a path param was removed
            if (isPathParam) {
                debounceAutoSave(() => autoSavePathParams());
            }

            // Update URL if a query param was removed
            if (isQueryParam) {
                updateUrlFromQueryParams();
                debounceAutoSave(() => autoSaveQueryParams());
            }

            // Auto-save headers if a header was removed
            if (isHeader) {
                debounceAutoSave(() => autoSaveHeaders());
            }
        }
    });
}

// Auto-save functionality
let autoSaveTimeout;
function debounceAutoSave(callback) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(callback, 500); // 500ms delay
}

async function autoSavePathParams() {
    if (window.currentEndpoint && window.collectionService) {
        const formElements = {
            pathParamsList: pathParamsList
        };
        await window.collectionService.saveCurrentPathParams(
            window.currentEndpoint.collectionId,
            window.currentEndpoint.endpointId,
            formElements
        );
    }
}

async function autoSaveQueryParams() {
    if (window.currentEndpoint && window.collectionService) {
        const formElements = {
            queryParamsList: queryParamsList
        };
        await window.collectionService.saveCurrentQueryParams(
            window.currentEndpoint.collectionId,
            window.currentEndpoint.endpointId,
            formElements
        );
    }
}

async function autoSaveHeaders() {
    if (window.currentEndpoint && window.collectionService) {
        const formElements = {
            headersList: headersList
        };
        await window.collectionService.saveCurrentHeaders(
            window.currentEndpoint.collectionId,
            window.currentEndpoint.endpointId,
            formElements
        );
    }
}