import { pathParamsList, addPathParamBtn, headersList, addHeaderBtn, queryParamsList, addQueryParamBtn, urlInput } from './domElements.js';

// Flag to prevent circular updates between query params and URL
let isUpdatingUrlFromQueryParams = false;

/**
 * Set the flag to prevent circular updates - call before programmatically updating URL
 */
export function setUrlUpdating(value) {
    isUpdatingUrlFromQueryParams = value;
}

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
    removeButton.classList.add('btn', 'btn-danger', 'btn-xs', 'remove-row-btn');
    removeButton.textContent = 'Remove';

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

/**
 * Populate a key-value list with data
 * @param {HTMLElement} listContainer
 * @param {Object} data - Key-value pairs to populate
 */
export function populateKeyValueList(listContainer, data) {
    if (!listContainer || !data) {return;}

    Object.entries(data).forEach(([key, value]) => {
        addKeyValueRow(listContainer, key, value);
    });
}

/**
 * Clear all rows from a key-value list
 * @param {HTMLElement} listContainer
 */
export function clearKeyValueList(listContainer) {
    if (!listContainer) {return;}
    listContainer.innerHTML = '';
}

/**
 * URL encode a value while preserving variable placeholders like {{variableName}}
 * This allows users to see their variables in the URL preview without encoding
 */
function encodeValuePreservingPlaceholders(value) {
    // Find all {{...}} patterns and temporarily replace them with placeholders
    const placeholders = [];
    let index = 0;

    const withPlaceholders = value.replace(/\{\{[^}]+\}\}/g, (match) => {
        const placeholder = `__PLACEHOLDER_${index}__`;
        placeholders.push({ placeholder, original: match });
        index++;
        return placeholder;
    });

    // URL encode the value (this encodes special chars but not our placeholders)
    const encoded = encodeURIComponent(withPlaceholders);

    // Restore the original {{...}} patterns
    let result = encoded;
    placeholders.forEach(({ placeholder, original }) => {
        result = result.replace(placeholder, original);
    });

    return result;
}

export function updateUrlFromQueryParams() {
    try {
        const queryParams = parseKeyValuePairs(queryParamsList);
        const urlString = urlInput.value.trim();

        if (!urlString) {
            return;
        }

        const questionMarkIndex = urlString.indexOf('?');
        const baseUrl = questionMarkIndex >= 0 ? urlString.substring(0, questionMarkIndex) : urlString;

        // Build query string with encoding that preserves variable placeholders
        const queryPairs = [];
        Object.entries(queryParams).forEach(([key, value]) => {
            if (key) {
                const encodedKey = encodeValuePreservingPlaceholders(key);
                const encodedValue = encodeValuePreservingPlaceholders(value);
                queryPairs.push(`${encodedKey}=${encodedValue}`);
            }
        });

        const queryString = queryPairs.join('&');

        // Set flag to prevent circular update when URL input event fires
        isUpdatingUrlFromQueryParams = true;
        urlInput.value = queryString ? `${baseUrl}?${queryString}` : baseUrl;
        // Clear flag after event loop to allow the input event to be skipped
        setTimeout(() => {
            isUpdatingUrlFromQueryParams = false;
        }, 0);
    } catch (error) {
        isUpdatingUrlFromQueryParams = false;
    }
}

export function updateQueryParamsFromUrl() {
    // Skip if we're in the middle of updating URL from query params to prevent circular update
    if (isUpdatingUrlFromQueryParams) {
        return;
    }

    try {
        const urlString = urlInput.value.trim();

        if (!urlString) {
            queryParamsList.innerHTML = '';
            addKeyValueRow(queryParamsList);
            return;
        }

        const questionMarkIndex = urlString.indexOf('?');

        queryParamsList.innerHTML = '';

        if (questionMarkIndex < 0) {
            addKeyValueRow(queryParamsList);
            return;
        }

        const queryString = urlString.substring(questionMarkIndex + 1);

        if (!queryString) {
            addKeyValueRow(queryParamsList);
            return;
        }

        // Parse query string manually to preserve variable placeholders like {{variableName}}
        // URLSearchParams doesn't handle unencoded braces correctly
        const pairs = queryString.split('&');
        let hasParams = false;

        for (const pair of pairs) {
            // Skip empty pairs
            if (!pair.trim()) {
                continue;
            }

            const equalIndex = pair.indexOf('=');

            if (equalIndex >= 0) {
                const key = pair.substring(0, equalIndex);
                const value = pair.substring(equalIndex + 1);

                // Decode URL-encoded values but preserve {{...}} patterns
                const decodedKey = decodeURIComponent(key);
                const decodedValue = decodeURIComponent(value);

                addKeyValueRow(queryParamsList, decodedKey, decodedValue);
                hasParams = true;
            } else {
                // Key without value
                addKeyValueRow(queryParamsList, decodeURIComponent(pair), '');
                hasParams = true;
            }
        }

        if (!hasParams) {
            addKeyValueRow(queryParamsList);
        }
    } catch (error) {
        if (queryParamsList.children.length === 0) {
            addKeyValueRow(queryParamsList);
        }
    }
}

export function initKeyValueListeners() {
    addPathParamBtn.addEventListener('click', () => addKeyValueRow(pathParamsList));
    addHeaderBtn.addEventListener('click', () => addKeyValueRow(headersList));
    addQueryParamBtn.addEventListener('click', () => addKeyValueRow(queryParamsList));

    urlInput.addEventListener('input', updateQueryParamsFromUrl);
    urlInput.addEventListener('blur', updateQueryParamsFromUrl);

    pathParamsList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            debounceAutoSave(() => autoSavePathParams());
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        }
    });

    queryParamsList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            updateUrlFromQueryParams();
            debounceAutoSave(() => autoSaveQueryParams());
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        }
    });

    headersList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            debounceAutoSave(() => autoSaveHeaders());
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-row-btn')) {
            const isPathParam = event.target.closest('#path-params-list');
            const isQueryParam = event.target.closest('#query-params-list');
            const isHeader = event.target.closest('#headers-list');
            event.target.closest('.key-value-row').remove();

            if (isPathParam) {
                debounceAutoSave(() => autoSavePathParams());
            }

            if (isQueryParam) {
                updateUrlFromQueryParams();
                debounceAutoSave(() => autoSaveQueryParams());
            }

            if (isHeader) {
                debounceAutoSave(() => autoSaveHeaders());
            }
        }
    });
}

let autoSaveTimeout;
function debounceAutoSave(callback) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(callback, 500);
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