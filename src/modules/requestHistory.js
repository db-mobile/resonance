import { requestListDiv, urlInput, methodSelect, bodyInput, responseBodyDisplay, responseHeadersDisplay } from './domElements.js';
import { updateStatusDisplay } from './statusDisplay.js';
import { addKeyValueRow, parseKeyValuePairs, initKeyValueListeners } from './keyValueManager.js'; // Ensure parseKeyValuePairs is exported
import { activateTab } from './tabManager.js';

let savedRequests = [];
let activeRequestItem = null;

function normalizeUrlForComparison(url) {
    try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (e) {
        return url;
    }
}

export async function saveRequest(requestDetails) {
    let currentRequests = await window.electronAPI.store.get('requests');

    const endpointIdentifier = `${requestDetails.method}_${normalizeUrlForComparison(requestDetails.url)}`;

    currentRequests = currentRequests.filter(req => {
        const existingEndpointIdentifier = `${req.method}_${normalizeUrlForComparison(req.url)}`;
        return existingEndpointIdentifier !== endpointIdentifier;
    });

    const newRequest = {
        id: Date.now() + Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toISOString(),
        ...requestDetails
    };

    currentRequests.unshift(newRequest);

    await window.electronAPI.store.set('requests', currentRequests);
    savedRequests = currentRequests;

    renderRequestList();
}

export async function loadRequests() {
    savedRequests = await window.electronAPI.store.get('requests');
    renderRequestList();
}

export function renderRequestList() {
    requestListDiv.innerHTML = '';

    if (savedRequests.length === 0) {
        requestListDiv.innerHTML = '<p style="text-align: center; color: #666; margin-top: 20px;">No requests saved yet.</p>';
        return;
    }

    savedRequests.forEach(req => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('request-item');
        itemDiv.dataset.requestId = req.id;

        const methodSpan = document.createElement('span');
        methodSpan.classList.add('request-item-method', req.method);
        methodSpan.textContent = req.method;

        const urlSpan = document.createElement('span');
        urlSpan.classList.add('request-item-url');
        try {
            const urlObj = new URL(req.url);
            urlSpan.textContent = urlObj.pathname + (urlObj.search ? urlObj.search : '');
            if (urlSpan.textContent.length > 30) {
                urlSpan.textContent = urlSpan.textContent.substring(0, 27) + '...';
            }
        } catch {
            urlSpan.textContent = req.url.substring(0, 30) + (req.url.length > 30 ? '...' : '');
        }

        const timestampDiv = document.createElement('div');
        timestampDiv.classList.add('request-item-timestamp');
        try {
            const date = new Date(req.timestamp);
            timestampDiv.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            timestampDiv.style.fontSize = '0.75em';
            timestampDiv.style.color = '#888';
            timestampDiv.style.marginTop = '5px';
        } catch {
            timestampDiv.textContent = '';
        }

        itemDiv.appendChild(methodSpan);
        itemDiv.appendChild(urlSpan);
        itemDiv.appendChild(timestampDiv);

        itemDiv.addEventListener('click', () => {
            if (activeRequestItem) {
                activeRequestItem.classList.remove('active');
            }
            itemDiv.classList.add('active');
            activeRequestItem = itemDiv;
            populateRequestForm(req);
        });

        requestListDiv.appendChild(itemDiv);
    });
}

export function populateRequestForm(requestDetails) {
    urlInput.value = requestDetails.url || '';
    methodSelect.value = requestDetails.method || 'GET';
    bodyInput.value = requestDetails.body ? JSON.stringify(requestDetails.body, null, 2) : '';

    const headersList = document.getElementById('headers-list'); // Re-get element for safety
    headersList.innerHTML = '';
    if (requestDetails.headers) {
        for (const key in requestDetails.headers) {
            addKeyValueRow(headersList, key, requestDetails.headers[key]);
        }
    }
    if (Object.keys(requestDetails.headers || {}).length === 0) {
        addKeyValueRow(headersList);
    }

    const queryParamsList = document.getElementById('query-params-list'); // Re-get element for safety
    queryParamsList.innerHTML = '';
    if (requestDetails.queryParams) {
        for (const key in requestDetails.queryParams) {
            addKeyValueRow(queryParamsList, key, requestDetails.queryParams[key]);
        }
    }
    if (Object.keys(requestDetails.queryParams || {}).length === 0) {
        addKeyValueRow(queryParamsList);
    }

    responseBodyDisplay.textContent = '';
    responseHeadersDisplay.textContent = '';
    updateStatusDisplay('Ready', null);

    if (Object.keys(requestDetails.queryParams || {}).length > 0) {
        activateTab('request', 'query-params');
    } else if (Object.keys(requestDetails.headers || {}).length > 0) {
        activateTab('request', 'headers');
    } else {
        activateTab('request', 'body');
    }
}