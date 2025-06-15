// renderer.js (Using IPC for API Calls with Tabs and improved status)

const urlInput = document.getElementById('url-input');
const methodSelect = document.getElementById('method-select');
const bodyInput = document.getElementById('body-input');
const sendRequestBtn = document.getElementById('send-request-btn');
const responseDisplay = document.getElementById('response-display');
const statusDisplay = document.getElementById('status-display'); // Get the status display element

// Elements for dynamic key-value pairs (now within tab content)
const headersList = document.getElementById('headers-list');
const addHeaderBtn = document.getElementById('add-header-btn');
const queryParamsList = document.getElementById('query-params-list');
const addQueryParamBtn = document.getElementById('add-query-param-btn');

// --- Tab Elements ---
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

// --- Helper Functions for Dynamic Key-Value Pairs (No change) ---

function createKeyValueRow(key = '', value = '') {
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
    removeButton.classList.add('remove-row-btn');
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
        row.remove();
    });

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeButton);

    return row;
}

function addKeyValueRow(listContainer, key = '', value = '') {
    const newRow = createKeyValueRow(key, value);
    listContainer.appendChild(newRow);
}

function parseKeyValuePairs(listContainer) {
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

// --- Status Display Helper Function ---
function updateStatusDisplay(statusText, statusCode = null) {
    // Clear previous status classes
    statusDisplay.classList.remove('status-success', 'status-redirect', 'status-client-error', 'status-server-error', 'status-info');

    statusDisplay.textContent = statusText;

    if (statusCode) {
        if (statusCode >= 200 && statusCode < 300) {
            statusDisplay.classList.add('status-success');
        } else if (statusCode >= 300 && statusCode < 400) {
            statusDisplay.classList.add('status-redirect');
        } else if (statusCode >= 400 && statusCode < 500) {
            statusDisplay.classList.add('status-client-error');
        } else if (statusCode >= 500 && statusCode < 600) {
            statusDisplay.classList.add('status-server-error');
        } else {
            statusDisplay.classList.add('status-info'); // For 1xx or unknown
        }
    } else {
        statusDisplay.classList.add('status-info'); // Default for generic messages like "Sending..."
    }
}


// --- Event Listeners for Adding Rows ---
addHeaderBtn.addEventListener('click', () => addKeyValueRow(headersList));
addQueryParamBtn.addEventListener('click', () => addKeyValueRow(queryParamsList));

// --- Event Listeners for Remove Buttons (Initial Rows) ---
document.querySelectorAll('.remove-row-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        event.target.closest('.key-value-row').remove();
    });
});


// --- Tab Switching Logic (No change) ---
tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        // Remove 'active' from all buttons and content
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        // Add 'active' to the clicked button
        button.classList.add('active');

        // Get the ID of the content to show from data-tab attribute
        const targetTabId = button.dataset.tab;
        const targetTabContent = document.getElementById(targetTabId);

        // Add 'active' to the corresponding content
        if (targetTabContent) {
            targetTabContent.classList.add('active');
        }
    });
});


// --- Send Request Button Logic ---
sendRequestBtn.addEventListener('click', async () => {
    let url = urlInput.value.trim();
    const method = methodSelect.value;
    let body = undefined;

    // Parse Headers
    const headers = parseKeyValuePairs(headersList);

    // Parse Query Parameters and append to URL
    const queryParams = parseKeyValuePairs(queryParamsList);
    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
    }

    // Parse Request Body
    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        try {
            body = JSON.parse(bodyInput.value);
        } catch (e) {
            updateStatusDisplay(`Invalid Body JSON: ${e.message}`, null); // Use helper for error
            return;
        }
    }

    // --- Using IPC to Main Process (Option 2) ---
    try {
        responseDisplay.textContent = 'Sending request...';
        updateStatusDisplay('Status: Sending...', null); // Use helper

        // window.electronAPI.sendApiRequest is exposed via preload.js
        const response = await window.electronAPI.sendApiRequest({
            method,
            url,
            headers,
            body
        });

        // Displaying the response
        responseDisplay.textContent = JSON.stringify(response.data, null, 2);
        updateStatusDisplay(`Status: ${response.status} ${response.statusText}`, response.status); // Use helper for success

    } catch (error) {
        // Handle errors returned from the main process
        let status = error.status || null;
        let errorMessage = error.message || 'Unknown error';

        if (error.data) {
            try {
                responseDisplay.textContent = `Error: ${JSON.stringify(error.data, null, 2)}`;
            } catch {
                responseDisplay.textContent = `Error: ${String(error.data)}`;
            }
        } else {
            responseDisplay.textContent = `Error: ${errorMessage}`;
        }

        updateStatusDisplay(`Status: ${status || 'N/A'}`, status); // Use helper for error status
        console.error('API Error (via IPC):', error);
    }
});

// Initial setup (Optional: Add default rows if needed, or rely on HTML initial rows)
document.addEventListener('DOMContentLoaded', () => {
    // Set initial status text
    updateStatusDisplay('Ready', null);
});