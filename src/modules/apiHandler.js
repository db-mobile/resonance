import { urlInput, methodSelect, bodyInput, sendRequestBtn, cancelRequestBtn, responseBodyDisplay, responseHeadersDisplay, responseLineNumbers } from './domElements.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { activateTab } from './tabManager.js'; // To ensure response tab is active
import { saveRequestBodyModification } from './collectionManager.js';
import { VariableProcessor } from './variables/VariableProcessor.js';
import { VariableRepository } from './storage/VariableRepository.js';
import { CollectionRepository } from './storage/CollectionRepository.js';
import { authManager } from './authManager.js';
import { generateCurlCommand } from './curlGenerator.js';
import { CurlDialog } from './ui/CurlDialog.js';

function generateLineNumbers(text) {
    if (!text) return '';
    const lines = text.split('\n');
    return lines.map((_, index) => index + 1).join('\n');
}

function displayResponseWithLineNumbers(content) {
    responseBodyDisplay.textContent = content;
    responseLineNumbers.textContent = generateLineNumbers(content);
}

function clearResponseDisplay() {
    responseBodyDisplay.textContent = '';
    responseLineNumbers.textContent = '';
}

function setRequestInProgress(inProgress) {
    if (inProgress) {
        sendRequestBtn.style.display = 'none';
        cancelRequestBtn.style.display = 'inline-block';
        sendRequestBtn.disabled = true;
    } else {
        sendRequestBtn.style.display = 'inline-block';
        cancelRequestBtn.style.display = 'none';
        sendRequestBtn.disabled = false;
    }
}

export async function handleCancelRequest() {
    try {
        const result = await window.electronAPI.cancelApiRequest();

        if (result.success) {
            updateStatusDisplay('Request cancelled', null);
            updateResponseTime(null);
            updateResponseSize(null);
            displayResponseWithLineNumbers('Request was cancelled by user');
            responseHeadersDisplay.textContent = '';
        }
    } catch (error) {
        console.error('Error cancelling request:', error);
        updateStatusDisplay('Error cancelling request', null);
        updateResponseTime(null);
        updateResponseSize(null);
    } finally {
        setRequestInProgress(false);
    }
}

export async function handleSendRequest() {
    if (window.currentEndpoint) {
        await saveRequestBodyModification(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
    }

    let url = urlInput.value.trim();
    const method = methodSelect.value;
    let body = undefined;

    const pathParams = parseKeyValuePairs(document.getElementById('path-params-list'));
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const authData = authManager.generateAuthData();

    Object.keys(authData.headers).forEach(key => {
        headers[key] = authData.headers[key];
    });

    Object.keys(authData.queryParams).forEach(key => {
        if (!queryParams[key]) {
            queryParams[key] = authData.queryParams[key];
        }
    });

    if (window.currentEndpoint) {
        try {
            const collectionRepository = new CollectionRepository(window.electronAPI);
            const variableRepository = new VariableRepository(window.electronAPI);
            
            const collection = await collectionRepository.getById(window.currentEndpoint.collectionId);
            
            if (collection && collection.defaultHeaders) {
                const mergedHeaders = { ...collection.defaultHeaders, ...headers };
                Object.assign(headers, mergedHeaders);
            }
            
            const variables = await variableRepository.getVariablesForCollection(window.currentEndpoint.collectionId);
            const processor = new VariableProcessor();

            const combinedVariables = { ...variables, ...pathParams };
            url = processor.processTemplate(url, combinedVariables);

            const processedHeaders = {};
            for (const [key, value] of Object.entries(headers)) {
                const processedKey = processor.processTemplate(key, variables);
                const processedValue = processor.processTemplate(value, variables);
                processedHeaders[processedKey] = processedValue;
            }
            for (const key in headers) {
                delete headers[key];
            }
            Object.assign(headers, processedHeaders);

            const processedQueryParams = {};
            for (const [key, value] of Object.entries(queryParams)) {
                const processedKey = processor.processTemplate(key, variables);
                const processedValue = processor.processTemplate(value, variables);
                processedQueryParams[processedKey] = processedValue;
            }
            for (const key in queryParams) {
                delete queryParams[key];
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
            
            if (window.currentEndpoint) {
                const variableRepository = new VariableRepository(window.electronAPI);
                const variables = await variableRepository.getVariablesForCollection(window.currentEndpoint.collectionId);
                const processor = new VariableProcessor();
                bodyText = processor.processTemplate(bodyText, variables);
            }
            
            body = JSON.parse(bodyText);
        } catch (e) {
            updateStatusDisplay(`Invalid Body JSON: ${e.message}`, null);
            clearResponseDisplay();
            responseHeadersDisplay.textContent = '';
            return;
        }
    }

    try {
        setRequestInProgress(true);
        
        activateTab('response', 'response-body');

        await new Promise(resolve => setTimeout(resolve, 100));

        if (responseBodyDisplay && responseBodyDisplay.parentElement) {
            responseBodyDisplay.parentElement.offsetHeight;
        }

        displayResponseWithLineNumbers('Sending request...');
        responseHeadersDisplay.textContent = '';
        updateStatusDisplay('Status: Sending...', null);

        const requestConfig = {
            method,
            url,
            headers,
            body
        };

        if (authData.authConfig) {
            requestConfig.auth = authData.authConfig;
        }

        const result = await window.electronAPI.sendApiRequest(requestConfig);

        if (result.success) {
            const formattedResponse = JSON.stringify(result.data, null, 2);
            displayResponseWithLineNumbers(formattedResponse);

            let headersString = '';
            if (result.headers) {
                headersString = JSON.stringify(result.headers, null, 2);
            }
            responseHeadersDisplay.textContent = headersString || 'No response headers.';

            updateStatusDisplay(`Status: ${result.status} ${result.statusText}`, result.status);
            updateResponseTime(result.ttfb);
            updateResponseSize(result.size);
            setRequestInProgress(false);

            // Add to history
            if (window.historyController) {
                await window.historyController.addHistoryEntry(requestConfig, result, window.currentEndpoint);
            }
        } else if (result.cancelled) {
            updateStatusDisplay('Request cancelled', null);
            updateResponseTime(null);
            updateResponseSize(null);
            displayResponseWithLineNumbers('Request was cancelled');
            responseHeadersDisplay.textContent = '';
            setRequestInProgress(false);
        } else {
            throw result;
        }

    } catch (error) {
        console.error('Full error object:', error);
        
        let status = error.status || null;
        let statusText = error.statusText || '';
        let errorMessage = error.message || 'Unknown error';

        let errorContent;
        if (error.data) {
            try {
                if (typeof error.data === 'object') {
                    errorContent = JSON.stringify(error.data, null, 2);
                } else {
                    errorContent = String(error.data);
                }
            } catch {
                errorContent = `Error: ${errorMessage}`;
            }
        } else {
            errorContent = `Error: ${errorMessage}`;
        }
        displayResponseWithLineNumbers(errorContent);
        
        if (error.headers && Object.keys(error.headers).length > 0) {
            try {
                responseHeadersDisplay.textContent = JSON.stringify(error.headers, null, 2);
            } catch {
                responseHeadersDisplay.textContent = 'Error parsing response headers.';
            }
        } else {
            responseHeadersDisplay.textContent = 'No headers available for error response.';
        }

        let statusDisplayText = 'Request Failed';
        if (status) {
            statusDisplayText = `${status}${statusText ? ` ${statusText}` : ''}`;
        }

        updateStatusDisplay(statusDisplayText, status);
        updateResponseTime(error.ttfb);
        updateResponseSize(error.size);
        console.error('API Error (via IPC):', error);

        // Add error to history
        if (window.historyController) {
            await window.historyController.addHistoryEntry(requestConfig, error, window.currentEndpoint);
        }
    } finally {
        setRequestInProgress(false);
    }
}

export async function handleGenerateCurl() {
    if (window.currentEndpoint) {
        await saveRequestBodyModification(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
    }

    let url = urlInput.value.trim();
    const method = methodSelect.value;
    let body = undefined;

    const pathParams = parseKeyValuePairs(document.getElementById('path-params-list'));
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const authData = authManager.generateAuthData();

    Object.keys(authData.headers).forEach(key => {
        headers[key] = authData.headers[key];
    });

    Object.keys(authData.queryParams).forEach(key => {
        if (!queryParams[key]) {
            queryParams[key] = authData.queryParams[key];
        }
    });

    if (window.currentEndpoint) {
        try {
            const collectionRepository = new CollectionRepository(window.electronAPI);
            const variableRepository = new VariableRepository(window.electronAPI);

            const collection = await collectionRepository.getById(window.currentEndpoint.collectionId);

            if (collection && collection.defaultHeaders) {
                const mergedHeaders = { ...collection.defaultHeaders, ...headers };
                Object.assign(headers, mergedHeaders);
            }

            const variables = await variableRepository.getVariablesForCollection(window.currentEndpoint.collectionId);
            const processor = new VariableProcessor();

            const combinedVariables = { ...variables, ...pathParams };
            url = processor.processTemplate(url, combinedVariables);

            const processedHeaders = {};
            for (const [key, value] of Object.entries(headers)) {
                const processedKey = processor.processTemplate(key, variables);
                const processedValue = processor.processTemplate(value, variables);
                processedHeaders[processedKey] = processedValue;
            }
            for (const key in headers) {
                delete headers[key];
            }
            Object.assign(headers, processedHeaders);

            const processedQueryParams = {};
            for (const [key, value] of Object.entries(queryParams)) {
                const processedKey = processor.processTemplate(key, variables);
                const processedValue = processor.processTemplate(value, variables);
                processedQueryParams[processedKey] = processedValue;
            }
            for (const key in queryParams) {
                delete queryParams[key];
            }
            Object.assign(queryParams, processedQueryParams);

        } catch (error) {
            console.error('Error processing variables:', error);
            updateStatusDisplay(`Variable processing error: ${error.message}`, null);
            return;
        }
    }

    const urlWithoutQuery = url.split('?')[0];

    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
        url = urlWithoutQuery + '?' + queryString;
    } else {
        url = urlWithoutQuery;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        try {
            let bodyText = bodyInput.value.trim();

            if (window.currentEndpoint) {
                const variableRepository = new VariableRepository(window.electronAPI);
                const variables = await variableRepository.getVariablesForCollection(window.currentEndpoint.collectionId);
                const processor = new VariableProcessor();
                bodyText = processor.processTemplate(bodyText, variables);
            }

            body = JSON.parse(bodyText);
        } catch (e) {
            updateStatusDisplay(`Invalid Body JSON: ${e.message}`, null);
            return;
        }
    }

    const requestConfig = {
        method,
        url,
        headers,
        body
    };

    const curlCommand = generateCurlCommand(requestConfig);

    const curlDialog = new CurlDialog();
    curlDialog.show(curlCommand);
}