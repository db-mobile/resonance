import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { pathParamsList, addPathParamBtn, headersList, addHeaderBtn, queryParamsList, addQueryParamBtn, urlInput } from './domElements.js';
import { debounce } from './utils/debounce.js';
import { notifyUrlUpdated } from './ui/mirroredUrlSection.js';

const debounceAutoSave = debounce((callback) => callback(), 500);

let isUpdatingUrlFromQueryParams = false;

/**
 * Set the flag to prevent circular updates - call before programmatically updating URL
 */
export function setUrlUpdating(value) {
    isUpdatingUrlFromQueryParams = value;
}

/**
 * Build a key-value row, optionally with an enable/disable checkbox
 * @param {string} key - Initial key
 * @param {string} value - Initial value
 * @param {Object} [options] - Row options
 * @param {boolean} [options.toggleable] - Whether the row gets an enabled checkbox
 * @param {boolean} [options.enabled] - Initial checkbox state
 * @returns {HTMLElement} The row element
 */
export function createKeyValueRow(key = '', value = '', options = {}) {
    const row = document.createElement('div');
    row.classList.add('key-value-row');

    if (options.toggleable) {
        const enabledInput = document.createElement('input');
        enabledInput.type = 'checkbox';
        enabledInput.classList.add('check', 'row-enabled-checkbox');
        enabledInput.checked = options.enabled !== false;
        enabledInput.setAttribute('aria-label', 'Enable parameter');
        enabledInput.title = 'Enable parameter';
        row.appendChild(enabledInput);
        row.classList.toggle('row-disabled', options.enabled === false);
    }

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
    removeButton.classList.add('remove-row-btn');
    removeButton.setAttribute('aria-label', 'Remove row');
    removeButton.title = 'Remove row';

    const removeIcon = document.createElement('span');
    removeIcon.classList.add('icon', 'icon-14', 'icon-x');
    removeButton.appendChild(removeIcon);

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeButton);

    return row;
}

/**
 * Whether rows of a list carry an enable/disable checkbox
 * @param {HTMLElement} listContainer - The list element
 * @returns {boolean} True when the list opts into toggleable rows
 */
function isToggleableList(listContainer) {
    return listContainer?.dataset?.toggleableRows === 'true';
}

/**
 * Append a key-value row to a list
 * @param {HTMLElement} listContainer - The list element
 * @param {string} key - Initial key
 * @param {string} value - Initial value
 * @param {boolean} [enabled] - Initial enabled state for toggleable lists
 * @returns {void}
 */
export function addKeyValueRow(listContainer, key = '', value = '', enabled = true) {
    const newRow = createKeyValueRow(key, value, {
        toggleable: isToggleableList(listContainer),
        enabled
    });
    listContainer.appendChild(newRow);
}

/**
 * Read the enabled state of a row
 * @param {HTMLElement} row - The row element
 * @returns {boolean} False only when a present checkbox is unchecked
 */
export function isRowEnabled(row) {
    return row.querySelector('.row-enabled-checkbox')?.checked !== false;
}

export function parseKeyValuePairs(listContainer) {
    const result = {};
    const rows = listContainer.querySelectorAll('.key-value-row');
    rows.forEach(row => {
        const keyInput = row.querySelector('.key-input');
        const valueInput = row.querySelector('.value-input');
        const key = keyInput.value.trim();
        const value = valueInput.value.trim();

        if (key && isRowEnabled(row)) {
            result[key] = value;
        }
    });
    return result;
}

/**
 * Read every row of a list, disabled ones included
 * @param {HTMLElement} listContainer - The list element
 * @returns {Array<Object>} Rows as {key, value, enabled}
 */
export function parseKeyValueRows(listContainer) {
    if (!listContainer) {return [];}

    const rows = [];
    listContainer.querySelectorAll('.key-value-row').forEach(row => {
        const key = row.querySelector('.key-input')?.value.trim() || '';
        const value = row.querySelector('.value-input')?.value.trim() || '';

        if (key) {
            rows.push({ key, value, enabled: isRowEnabled(row) });
        }
    });
    return rows;
}

/**
 * Populate a key-value list with data
 * @param {HTMLElement} listContainer
 * @param {Object|Array<Object>} data - Key-value map or array of {key, value, enabled} rows
 */
export function populateKeyValueList(listContainer, data) {
    if (!listContainer || !data) {return;}

    if (Array.isArray(data)) {
        data.forEach(row => {
            if (row && row.key !== undefined) {
                addKeyValueRow(listContainer, row.key, row.value || '', row.enabled !== false);
            }
        });
        return;
    }

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
    const placeholders = [];
    let index = 0;

    const withPlaceholders = value.replace(/\{\{[^}]+\}\}/g, (match) => {
        const placeholder = `__PLACEHOLDER_${index}__`;
        placeholders.push({ placeholder, original: match });
        index++;
        return placeholder;
    });

    const encoded = encodeURIComponent(withPlaceholders);

    let result = encoded;
    placeholders.forEach(({ placeholder, original }) => {
        result = result.replace(placeholder, original);
    });

    return result;
}

export function updateUrlFromQueryParams() {
    try {
        const queryRows = parseKeyValueRows(queryParamsList).filter((row) => row.enabled);
        const urlString = urlInput.value.trim();

        if (!urlString) {
            return;
        }

        const questionMarkIndex = urlString.indexOf('?');
        const baseUrl = questionMarkIndex >= 0 ? urlString.substring(0, questionMarkIndex) : urlString;

        const queryPairs = [];
        queryRows.forEach(({ key, value }) => {
            if (key) {
                const encodedKey = encodeValuePreservingPlaceholders(key);
                const encodedValue = encodeValuePreservingPlaceholders(value);
                queryPairs.push(`${encodedKey}=${encodedValue}`);
            }
        });

        const queryString = queryPairs.join('&');

        isUpdatingUrlFromQueryParams = true;
        urlInput.value = queryString ? `${baseUrl}?${queryString}` : baseUrl;
        notifyUrlUpdated(urlInput);
        setTimeout(() => {
            isUpdatingUrlFromQueryParams = false;
        }, 0);
    } catch (error) {
        isUpdatingUrlFromQueryParams = false;
    }
}

/**
 * Decodes a URI component, keeping the raw text when it is not valid percent-encoding.
 * @param {string} component - Raw query-string fragment
 * @returns {string} Decoded or original text
 */
function safeDecodeURIComponent(component) {
    try {
        return decodeURIComponent(component);
    } catch (error) {
        void error;
        return component;
    }
}

/**
 * Snapshot the disabled query param rows so a URL round trip cannot destroy them
 * @returns {Array<Object>} Rows as {index, key, value}
 */
function captureDisabledQueryParams() {
    const disabledRows = [];
    queryParamsList.querySelectorAll('.key-value-row').forEach((row, index) => {
        if (!isRowEnabled(row)) {
            disabledRows.push({
                index,
                key: row.querySelector('.key-input')?.value || '',
                value: row.querySelector('.value-input')?.value || ''
            });
        }
    });
    return disabledRows;
}

/**
 * Re-insert disabled query param rows at the positions they were captured from
 * @param {Array<Object>} disabledRows - Rows from captureDisabledQueryParams
 * @returns {void}
 */
function restoreDisabledQueryParams(disabledRows) {
    disabledRows.forEach(({ index, key, value }) => {
        const row = createKeyValueRow(key, value, {
            toggleable: isToggleableList(queryParamsList),
            enabled: false
        });
        queryParamsList.insertBefore(row, queryParamsList.children[index] || null);
    });
}

export function updateQueryParamsFromUrl() {
    if (isUpdatingUrlFromQueryParams) {
        return;
    }

    const disabledRows = captureDisabledQueryParams();

    try {
        const urlString = urlInput.value.trim();
        const questionMarkIndex = urlString.indexOf('?');
        const queryString = questionMarkIndex >= 0 ? urlString.substring(questionMarkIndex + 1) : '';

        queryParamsList.innerHTML = '';

        for (const pair of queryString.split('&')) {
            if (!pair.trim()) {
                continue;
            }

            const equalIndex = pair.indexOf('=');

            if (equalIndex >= 0) {
                const key = pair.substring(0, equalIndex);
                const value = pair.substring(equalIndex + 1);

                addKeyValueRow(queryParamsList, safeDecodeURIComponent(key), safeDecodeURIComponent(value));
            } else {
                addKeyValueRow(queryParamsList, safeDecodeURIComponent(pair), '');
            }
        }
    } catch (error) {
        void error;
    }

    restoreDisabledQueryParams(disabledRows);

    if (queryParamsList.children.length === 0) {
        addKeyValueRow(queryParamsList);
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
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        }
    });

    queryParamsList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            updateUrlFromQueryParams();
            debounceAutoSave(() => autoSaveQueryParams());
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        }
    });

    queryParamsList.addEventListener('change', (event) => {
        if (!event.target.classList.contains('row-enabled-checkbox')) {
            return;
        }

        event.target.closest('.key-value-row')?.classList.toggle('row-disabled', !event.target.checked);
        updateUrlFromQueryParams();
        debounceAutoSave(() => autoSaveQueryParams());
        if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
            app.workspaceTabController.markCurrentTabModified();
        }
    });

    headersList.addEventListener('input', (event) => {
        if (event.target.classList.contains('key-input') ||
            event.target.classList.contains('value-input')) {
            debounceAutoSave(() => autoSaveHeaders());
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        }
    });

    headersList.addEventListener('change', (event) => {
        if (!event.target.classList.contains('row-enabled-checkbox')) {
            return;
        }

        event.target.closest('.key-value-row')?.classList.toggle('row-disabled', !event.target.checked);
        debounceAutoSave(() => autoSaveHeaders());
        if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
            app.workspaceTabController.markCurrentTabModified();
        }
    });

    document.addEventListener('click', (event) => {
        const removeBtn = event.target.closest('.remove-row-btn');
        if (removeBtn) {
            const isPathParam = removeBtn.closest('#path-params-list');
            const isQueryParam = removeBtn.closest('#query-params-list');
            const isHeader = removeBtn.closest('#headers-list');
            const row = removeBtn.closest('.key-value-row');
            if (!row) {
                return;
            }
            row.remove();

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


async function autoSavePathParams() {
    if (getCurrentEndpoint() && app.collectionService) {
        const formElements = {
            pathParamsList: pathParamsList
        };
        await app.collectionService.saveCurrentPathParams(
            getCurrentEndpoint().collectionId,
            getCurrentEndpoint().endpointId,
            formElements
        );
    }
}

async function autoSaveQueryParams() {
    if (getCurrentEndpoint() && app.collectionService) {
        const formElements = {
            queryParamsList: queryParamsList
        };
        await app.collectionService.saveCurrentQueryParams(
            getCurrentEndpoint().collectionId,
            getCurrentEndpoint().endpointId,
            formElements
        );
    }
}

async function autoSaveHeaders() {
    if (getCurrentEndpoint() && app.collectionService) {
        const formElements = {
            headersList: headersList
        };
        await app.collectionService.saveCurrentHeaders(
            getCurrentEndpoint().collectionId,
            getCurrentEndpoint().endpointId,
            formElements
        );
    }
}