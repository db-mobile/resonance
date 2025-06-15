import { urlInput, methodSelect, bodyInput, responseBodyDisplay, responseHeadersDisplay } from './domElements.js';
import { updateStatusDisplay } from './statusDisplay.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { saveRequest } from './requestHistory.js';
import { activateTab } from './tabManager.js'; // To ensure response tab is active

export async function handleSendRequest() {
    let url = urlInput.value.trim();
    const method = methodSelect.value;
    let body = undefined;

    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const originalUrlForSaving = url;

    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        try {
            body = JSON.parse(bodyInput.value);
        } catch (e) {
            updateStatusDisplay(`Invalid Body JSON: ${e.message}`, null);
            responseBodyDisplay.textContent = '';
            responseHeadersDisplay.textContent = '';
            return;
        }
    }

    try {
        activateTab('response', 'response-body');

        await new Promise(resolve => setTimeout(resolve, 100));

        if (responseBodyDisplay && responseBodyDisplay.parentElement) {
            responseBodyDisplay.parentElement.offsetHeight;
        }

        responseBodyDisplay.textContent = 'Sending request...';
        responseHeadersDisplay.textContent = '';
        updateStatusDisplay('Status: Sending...', null);

        const response = await window.electronAPI.sendApiRequest({
            method,
            url,
            headers,
            body
        });

        responseBodyDisplay.textContent = JSON.stringify(response.data, null, 2);

        let headersString = '';
        if (response.headers) {
            if (typeof response.headers.entries === 'function') {
                for (const [key, value] of response.headers.entries()) {
                    headersString += `${key}: ${value}\n`;
                }
            } else {
                headersString = JSON.stringify(response.headers, null, 2);
            }
        }
        responseHeadersDisplay.textContent = headersString || 'No response headers.';

        updateStatusDisplay(`Status: ${response.status} ${response.statusText}`, response.status);

        await saveRequest({
            url: originalUrlForSaving,
            method,
            headers,
            queryParams,
            body
        });

    } catch (error) {
        let status = error.status || null;
        let errorMessage = error.message || 'Unknown error';

        if (error.data) {
            try {
                responseBodyDisplay.textContent = `Error: ${JSON.stringify(error.data, null, 2)}`;
            } catch {
                responseBodyDisplay.textContent = `Error: ${String(error.data)}`;
            }
        } else {
            responseBodyDisplay.textContent = `Error: ${errorMessage}`;
        }
        responseHeadersDisplay.textContent = 'No headers available for error response.';

        updateStatusDisplay(`Status: ${status || 'N/A'}`, status);
        console.error('API Error (via IPC):', error);
    }
}