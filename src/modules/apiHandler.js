import { urlInput, methodSelect, bodyInput, responseBodyDisplay, responseHeadersDisplay } from './domElements.js';
import { updateStatusDisplay } from './statusDisplay.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { activateTab } from './tabManager.js'; // To ensure response tab is active
import { saveRequestBodyModification } from './collectionManager.js';
import { VariableProcessor } from './variables/VariableProcessor.js';
import { VariableRepository } from './storage/VariableRepository.js';
import { CollectionRepository } from './storage/CollectionRepository.js';

export async function handleSendRequest() {
    // Save any pending body modifications before sending request
    if (window.currentEndpoint) {
        await saveRequestBodyModification(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
    }

    let url = urlInput.value.trim();
    const method = methodSelect.value;
    let body = undefined;

    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    // Process variables and merge default headers if we have a current endpoint
    if (window.currentEndpoint) {
        try {
            const collectionRepository = new CollectionRepository(window.electronAPI);
            const variableRepository = new VariableRepository(window.electronAPI);
            
            // Get collection data for default headers
            const collection = await collectionRepository.getById(window.currentEndpoint.collectionId);
            
            // Merge default headers from collection (they go first, can be overridden)
            if (collection && collection.defaultHeaders) {
                const mergedHeaders = { ...collection.defaultHeaders, ...headers };
                Object.assign(headers, mergedHeaders);
            }
            
            // Process variables in URL, headers, query params, and body
            const variables = await variableRepository.getVariablesForCollection(window.currentEndpoint.collectionId);
            const processor = new VariableProcessor();
            
            url = processor.processTemplate(url, variables);
            
            // Process headers
            const processedHeaders = {};
            for (const [key, value] of Object.entries(headers)) {
                const processedKey = processor.processTemplate(key, variables);
                const processedValue = processor.processTemplate(value, variables);
                processedHeaders[processedKey] = processedValue;
            }
            Object.assign(headers, processedHeaders);
            
            // Process query params
            const processedQueryParams = {};
            for (const [key, value] of Object.entries(queryParams)) {
                const processedKey = processor.processTemplate(key, variables);
                const processedValue = processor.processTemplate(value, variables);
                processedQueryParams[processedKey] = processedValue;
            }
            Object.assign(queryParams, processedQueryParams);
            
        } catch (error) {
            console.error('Error processing variables:', error);
            updateStatusDisplay(`Variable processing error: ${error.message}`, null);
            return;
        }
    }


    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        try {
            let bodyText = bodyInput.value.trim();
            
            // Process variables in body if we have a current endpoint
            if (window.currentEndpoint) {
                const variableRepository = new VariableRepository(window.electronAPI);
                const variables = await variableRepository.getVariablesForCollection(window.currentEndpoint.collectionId);
                const processor = new VariableProcessor();
                bodyText = processor.processTemplate(bodyText, variables);
            }
            
            body = JSON.parse(bodyText);
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

        const result = await window.electronAPI.sendApiRequest({
            method,
            url,
            headers,
            body
        });

        // Check if the request was successful
        if (result.success) {
            // Handle successful response
            responseBodyDisplay.textContent = JSON.stringify(result.data, null, 2);

            let headersString = '';
            if (result.headers) {
                headersString = JSON.stringify(result.headers, null, 2);
            }
            responseHeadersDisplay.textContent = headersString || 'No response headers.';

            updateStatusDisplay(`Status: ${result.status} ${result.statusText}`, result.status);
        } else {
            // Handle error response (but don't throw, handle it here)
            throw result; // This will be caught by the catch block below
        }

    } catch (error) {
        console.error('Full error object:', error);
        
        let status = error.status || null;
        let statusText = error.statusText || '';
        let errorMessage = error.message || 'Unknown error';

        // Display error response body or fallback to error message
        if (error.data) {
            try {
                // If it's a JSON error response, format it nicely
                if (typeof error.data === 'object') {
                    responseBodyDisplay.textContent = JSON.stringify(error.data, null, 2);
                } else {
                    responseBodyDisplay.textContent = String(error.data);
                }
            } catch {
                responseBodyDisplay.textContent = `Error: ${errorMessage}`;
            }
        } else {
            responseBodyDisplay.textContent = `Error: ${errorMessage}`;
        }
        
        // Handle headers for error responses
        if (error.headers && Object.keys(error.headers).length > 0) {
            try {
                responseHeadersDisplay.textContent = JSON.stringify(error.headers, null, 2);
            } catch {
                responseHeadersDisplay.textContent = 'Error parsing response headers.';
            }
        } else {
            responseHeadersDisplay.textContent = 'No headers available for error response.';
        }

        // Create a proper status display
        let statusDisplayText = 'Request Failed';
        if (status) {
            statusDisplayText = `${status}${statusText ? ` ${statusText}` : ''}`;
        }

        updateStatusDisplay(statusDisplayText, status);
        console.error('API Error (via IPC):', error);
    }
}