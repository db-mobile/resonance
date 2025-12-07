import { urlInput, methodSelect, bodyInput, sendRequestBtn, cancelRequestBtn, responseBodyContainer, responseHeadersDisplay, responseCookiesDisplay, responsePerformanceDisplay, languageSelector } from './domElements.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { activateTab } from './tabManager.js'; // To ensure response tab is active
import { saveAllRequestModifications } from './collectionManager.js';
import { VariableProcessor } from './variables/VariableProcessor.js';
import { VariableRepository } from './storage/VariableRepository.js';
import { EnvironmentRepository } from './storage/EnvironmentRepository.js';
import { CollectionRepository } from './storage/CollectionRepository.js';
import { VariableService } from './services/VariableService.js';
import { StatusDisplayAdapter } from './interfaces/IStatusDisplay.js';
import { authManager } from './authManager.js';
import { CodeSnippetDialog } from './ui/CodeSnippetDialog.js';
import { ResponseEditor } from './responseEditor.bundle.js';
import { extractCookies, formatCookiesAsHtml } from './cookieParser.js';
import { displayPerformanceMetrics, clearPerformanceMetrics } from './performanceMetrics.js';

// Initialize CodeMirror editor for response display
let responseEditor = null;

// Helper function to get variable service with environment support
function getVariableService() {
    const variableRepository = new VariableRepository(window.electronAPI);
    const environmentRepository = new EnvironmentRepository(window.electronAPI);
    const variableProcessor = new VariableProcessor();
    const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);

    return new VariableService(variableRepository, variableProcessor, statusDisplayAdapter, environmentRepository);
}

export function initResponseEditor() {
    if (!responseEditor && responseBodyContainer) {
        responseEditor = new ResponseEditor(responseBodyContainer);

        // Set up callback to update dropdown when language changes
        responseEditor.onLanguageChange((languageType) => {
            if (languageSelector) {
                // If manual override is not set, show as "auto"
                if (responseEditor.manualLanguageOverride === null) {
                    languageSelector.value = 'auto';
                } else {
                    languageSelector.value = languageType || 'text';
                }
            }
        });

        // Set up language selector event listener
        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLanguage = e.target.value;
                if (selectedLanguage === 'auto') {
                    responseEditor.clearLanguageOverride();
                } else {
                    responseEditor.setLanguage(selectedLanguage);
                }
            });
        }
    }
}

/**
 * Get the current response body content from the editor
 * @returns {string}
 */
export function getResponseBodyContent() {
    if (responseEditor) {
        return responseEditor.getContent();
    }
    return '';
}

export function displayResponseWithLineNumbers(content, contentType = null) {
    // Use per-tab editor if available, otherwise fall back to global editor
    const containerElements = window.responseContainerManager?.getActiveElements();

    if (containerElements && containerElements.editor) {
        containerElements.editor.setContent(content, contentType);
    } else {
        // Fallback to global editor
        initResponseEditor();
        if (responseEditor) {
            responseEditor.setContent(content, contentType);
        }
    }
}

export function clearResponseDisplay() {
    // Use per-tab editor if available, otherwise fall back to global editor
    const containerElements = window.responseContainerManager?.getActiveElements();

    if (containerElements && containerElements.editor) {
        containerElements.editor.clear();
    } else {
        // Fallback to global editor
        initResponseEditor();
        if (responseEditor) {
            responseEditor.clear();
        }
    }
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

            // Use per-tab elements if available
            const containerElements = window.responseContainerManager?.getActiveElements();
            if (containerElements) {
                if (containerElements.headersDisplay) {containerElements.headersDisplay.textContent = '';}
                if (containerElements.cookiesDisplay) {containerElements.cookiesDisplay.innerHTML = '';}
                if (containerElements.performanceDisplay) {clearPerformanceMetrics(containerElements.performanceDisplay);}
            } else {
                // Fallback to global elements
                if (responseHeadersDisplay) {responseHeadersDisplay.textContent = '';}
                if (responseCookiesDisplay) {responseCookiesDisplay.innerHTML = '';}
                if (responsePerformanceDisplay) {clearPerformanceMetrics(responsePerformanceDisplay);}
            }
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
        await saveAllRequestModifications(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
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

    // Always try to substitute variables (collection + environment or just environment)
    try {
        const variableService = getVariableService();
        let variables = {};

        if (window.currentEndpoint) {
            // Get collection-specific variables + environment variables
            const collectionRepository = new CollectionRepository(window.electronAPI);
            const collection = await collectionRepository.getById(window.currentEndpoint.collectionId);

            if (collection && collection.defaultHeaders) {
                const mergedHeaders = { ...collection.defaultHeaders, ...headers };
                Object.assign(headers, mergedHeaders);
            }

            variables = await variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
        } else {
            // No endpoint loaded - use environment variables only
            variables = await variableService.getVariables();
        }

        const processor = new VariableProcessor();

        // First, substitute variables in path param VALUES (so {{var}} in path params get replaced)
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        // Then substitute variables in URL (include processed path params)
        const combinedVariables = { ...variables, ...processedPathParams };
        url = processor.processTemplate(url, combinedVariables);

        // Substitute variables in headers
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

        // Substitute variables in query params
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


    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        try {
            let bodyText = bodyInput.value.trim();

            // Always try to substitute variables in body (collection + environment or just environment)
            const variableService = getVariableService();
            let variables = {};

            if (window.currentEndpoint) {
                variables = await variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
            } else {
                variables = await variableService.getVariables();
            }

            const processor = new VariableProcessor();
            bodyText = processor.processTemplate(bodyText, variables);

            body = JSON.parse(bodyText);
        } catch (e) {
            updateStatusDisplay(`Invalid Body JSON: ${e.message}`, null);
            clearResponseDisplay();
            responseHeadersDisplay.textContent = '';
            return;
        }
    }

    // Define requestConfig outside try block so it's accessible in catch block
    const requestConfig = {
        method,
        url,
        headers,
        body
    };

    try {
        setRequestInProgress(true);

        activateTab('response', 'response-body');

        await new Promise(resolve => setTimeout(resolve, 100));

        if (responseBodyContainer && responseBodyContainer.parentElement) {
            void responseBodyContainer.parentElement.offsetHeight; // Force reflow
        }

        displayResponseWithLineNumbers('Sending request...');

        // Clear response displays using per-tab elements if available
        const containerElements = window.responseContainerManager?.getActiveElements();
        if (containerElements) {
            if (containerElements.headersDisplay) {containerElements.headersDisplay.textContent = '';}
            if (containerElements.cookiesDisplay) {containerElements.cookiesDisplay.innerHTML = '';}
            if (containerElements.performanceDisplay) {clearPerformanceMetrics(containerElements.performanceDisplay);}
        } else {
            // Fallback to global elements
            if (responseHeadersDisplay) {responseHeadersDisplay.textContent = '';}
            if (responseCookiesDisplay) {responseCookiesDisplay.innerHTML = '';}
            if (responsePerformanceDisplay) {clearPerformanceMetrics(responsePerformanceDisplay);}
        }

        updateStatusDisplay('Status: Sending...', null);

        if (authData.authConfig) {
            requestConfig.auth = authData.authConfig;
        }

        const result = await window.electronAPI.sendApiRequest(requestConfig);

        if (result.success) {
            const formattedResponse = JSON.stringify(result.data, null, 2);

            // Extract content-type from response headers
            let contentType = null;
            if (result.headers && result.headers['content-type']) {
                contentType = result.headers['content-type'];
            }

            // Display response body (currently uses global editor - TODO: make per-tab)
            displayResponseWithLineNumbers(formattedResponse, contentType);

            // Get active workspace tab's response container elements for headers/cookies/performance
            const containerElements = window.responseContainerManager?.getActiveElements();

            if (containerElements) {
                // Write headers to workspace tab's container
                let headersString = '';
                if (result.headers) {
                    headersString = JSON.stringify(result.headers, null, 2);
                }
                containerElements.headersDisplay.textContent = headersString || 'No response headers.';

                // Parse and display cookies to workspace tab's container
                const cookies = extractCookies(result.headers);
                containerElements.cookiesDisplay.innerHTML = formatCookiesAsHtml(cookies);

                // Display performance metrics to workspace tab's container
                displayPerformanceMetrics(containerElements.performanceDisplay, result.timings, result.size);
            } else {
                // Fallback to global elements
                let headersString = '';
                if (result.headers) {
                    headersString = JSON.stringify(result.headers, null, 2);
                }
                responseHeadersDisplay.textContent = headersString || 'No response headers.';

                const cookies = extractCookies(result.headers);
                responseCookiesDisplay.innerHTML = formatCookiesAsHtml(cookies);

                displayPerformanceMetrics(responsePerformanceDisplay, result.timings, result.size);
            }

            // Save response data to workspace tab
            if (window.workspaceTabController) {
                const activeTabId = await window.workspaceTabController.service.getActiveTabId();
                if (activeTabId) {
                    await window.workspaceTabController.service.updateTab(activeTabId, {
                        response: {
                            data: result.data,
                            headers: result.headers || {},
                            status: result.status,
                            statusText: result.statusText,
                            ttfb: result.ttfb,
                            size: result.size,
                            timings: result.timings,
                            cookies: extractCookies(result.headers)
                        },
                        isModified: false
                    });
                    await window.workspaceTabController.markCurrentTabUnmodified();
                }
            }

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

            // Use per-tab elements if available
            const containerElements = window.responseContainerManager?.getActiveElements();
            if (containerElements) {
                if (containerElements.headersDisplay) {containerElements.headersDisplay.textContent = '';}
                if (containerElements.cookiesDisplay) {containerElements.cookiesDisplay.innerHTML = '';}
                if (containerElements.performanceDisplay) {clearPerformanceMetrics(containerElements.performanceDisplay);}
            } else {
                // Fallback to global elements
                if (responseHeadersDisplay) {responseHeadersDisplay.textContent = '';}
                if (responseCookiesDisplay) {responseCookiesDisplay.innerHTML = '';}
                if (responsePerformanceDisplay) {clearPerformanceMetrics(responsePerformanceDisplay);}
            }
            setRequestInProgress(false);
        } else {
            throw result;
        }

    } catch (error) {
        console.error('Full error object:', error);

        const status = error.status || null;
        const statusText = error.statusText || '';
        const errorMessage = error.message || 'Unknown error';

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

        // Extract content-type from error headers if available
        let contentType = null;
        if (error.headers && error.headers['content-type']) {
            contentType = error.headers['content-type'];
        }

        displayResponseWithLineNumbers(errorContent, contentType);

        // Get active workspace tab's response container elements
        const containerElements = window.responseContainerManager?.getActiveElements();

        if (error.headers && Object.keys(error.headers).length > 0) {
            try {
                const headersText = JSON.stringify(error.headers, null, 2);
                if (containerElements && containerElements.headersDisplay) {
                    containerElements.headersDisplay.textContent = headersText;
                } else if (responseHeadersDisplay) {
                    responseHeadersDisplay.textContent = headersText;
                }
            } catch {
                if (containerElements && containerElements.headersDisplay) {
                    containerElements.headersDisplay.textContent = 'Error parsing response headers.';
                } else if (responseHeadersDisplay) {
                    responseHeadersDisplay.textContent = 'Error parsing response headers.';
                }
            }

            // Parse and display cookies from error response
            const cookies = extractCookies(error.headers);
            const cookiesHtml = formatCookiesAsHtml(cookies);
            if (containerElements && containerElements.cookiesDisplay) {
                containerElements.cookiesDisplay.innerHTML = cookiesHtml;
            } else if (responseCookiesDisplay) {
                responseCookiesDisplay.innerHTML = cookiesHtml;
            }
        } else {
            if (containerElements && containerElements.headersDisplay) {
                containerElements.headersDisplay.textContent = 'No headers available for error response.';
            } else if (responseHeadersDisplay) {
                responseHeadersDisplay.textContent = 'No headers available for error response.';
            }

            if (containerElements && containerElements.cookiesDisplay) {
                containerElements.cookiesDisplay.innerHTML = '';
            } else if (responseCookiesDisplay) {
                responseCookiesDisplay.innerHTML = '';
            }
        }

        // Display performance metrics for error responses
        if (error.timings) {
            if (containerElements && containerElements.performanceDisplay) {
                displayPerformanceMetrics(containerElements.performanceDisplay, error.timings, error.size);
            } else if (responsePerformanceDisplay) {
                displayPerformanceMetrics(responsePerformanceDisplay, error.timings, error.size);
            }
        } else if (containerElements && containerElements.performanceDisplay) {
                clearPerformanceMetrics(containerElements.performanceDisplay);
            } else if (responsePerformanceDisplay) {
                clearPerformanceMetrics(responsePerformanceDisplay);
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
        await saveAllRequestModifications(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
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

    // Always try to substitute variables (collection + environment or just environment)
    try {
        const variableService = getVariableService();
        let variables = {};

        if (window.currentEndpoint) {
            // Get collection-specific variables + environment variables
            const collectionRepository = new CollectionRepository(window.electronAPI);
            const collection = await collectionRepository.getById(window.currentEndpoint.collectionId);

            if (collection && collection.defaultHeaders) {
                const mergedHeaders = { ...collection.defaultHeaders, ...headers };
                Object.assign(headers, mergedHeaders);
            }

            variables = await variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
        } else {
            // No endpoint loaded - use environment variables only
            variables = await variableService.getVariables();
        }

        const processor = new VariableProcessor();

        // First, substitute variables in path param VALUES (so {{var}} in path params get replaced)
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        // Then substitute variables in URL (include processed path params)
        const combinedVariables = { ...variables, ...processedPathParams };
        url = processor.processTemplate(url, combinedVariables);

        // Substitute variables in headers
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

        // Substitute variables in query params
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

    const urlWithoutQuery = url.split('?')[0];

    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
        url = `${urlWithoutQuery  }?${  queryString}`;
    } else {
        url = urlWithoutQuery;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput.value.trim()) {
        try {
            let bodyText = bodyInput.value.trim();

            // Always try to substitute variables in body (collection + environment or just environment)
            const variableService = getVariableService();
            let variables = {};

            if (window.currentEndpoint) {
                variables = await variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
            } else {
                variables = await variableService.getVariables();
            }

            const processor = new VariableProcessor();
            bodyText = processor.processTemplate(bodyText, variables);

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

    const codeSnippetDialog = new CodeSnippetDialog();
    codeSnippetDialog.show(requestConfig);
}