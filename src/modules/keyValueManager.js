import { headersList, addHeaderBtn, queryParamsList, addQueryParamBtn, urlInput } from './domElements.js';

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
    const queryParams = parseKeyValuePairs(queryParamsList);
    const url = new URL(urlInput.value.trim() || 'http://example.com');
    
    // Clear existing query parameters
    url.search = '';
    
    // Add query params from the list
    Object.entries(queryParams).forEach(([key, value]) => {
        if (key) {
            url.searchParams.set(key, value);
        }
    });
    
    urlInput.value = url.toString();
}

export function updateQueryParamsFromUrl() {
    try {
        const url = new URL(urlInput.value.trim() || 'http://example.com');
        
        // Clear existing query param rows
        queryParamsList.innerHTML = '';
        
        // Add rows for each URL query parameter
        const hasParams = url.searchParams.size > 0;
        if (hasParams) {
            url.searchParams.forEach((value, key) => {
                addKeyValueRow(queryParamsList, key, value);
            });
        } else {
            // Add empty row if no params
            addKeyValueRow(queryParamsList);
        }
    } catch (error) {
        // If URL is invalid, just ensure we have at least one empty row
        if (queryParamsList.children.length === 0) {
            addKeyValueRow(queryParamsList);
        }
    }
}

export function initKeyValueListeners() {
    addHeaderBtn.addEventListener('click', () => addKeyValueRow(headersList));
    addQueryParamBtn.addEventListener('click', () => addKeyValueRow(queryParamsList));

    // URL input change listener
    urlInput.addEventListener('input', updateQueryParamsFromUrl);
    urlInput.addEventListener('blur', updateQueryParamsFromUrl);

    // Query params input listeners (using event delegation)
    queryParamsList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') || 
            event.target.classList.contains('value-input')) {
            updateUrlFromQueryParams();
        }
    });

    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-row-btn')) {
            const isQueryParam = event.target.closest('#query-params-list');
            event.target.closest('.key-value-row').remove();
            
            // Update URL if a query param was removed
            if (isQueryParam) {
                updateUrlFromQueryParams();
            }
        }
    });
}