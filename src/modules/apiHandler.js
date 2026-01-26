import { urlInput, methodSelect, sendRequestBtn, cancelRequestBtn, responseBodyContainer, responseHeadersDisplay, responseCookiesDisplay, responsePerformanceDisplay, languageSelector } from './domElements.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs } from './keyValueManager.js';
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
import { getRequestBodyContent } from './requestBodyHelper.js';
import { MockServerRepository } from './storage/MockServerRepository.js';
import { MockServerService } from './services/MockServerService.js';

// Initialize CodeMirror editor for response display
let responseEditor = null;

// GraphQL body manager instance (set by renderer)
let graphqlBodyManager = null;

export function setGraphQLBodyManager(manager) {
    graphqlBodyManager = manager;
}

// Helper function to get variable service with environment support
function getVariableService() {
    const variableRepository = new VariableRepository(window.backendAPI);
    const environmentRepository = new EnvironmentRepository(window.backendAPI);
    const variableProcessor = new VariableProcessor();
    const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);

    return new VariableService(variableRepository, variableProcessor, statusDisplayAdapter, environmentRepository);
}

// Helper function to get mock server service
function getMockServerService() {
    const mockServerRepository = new MockServerRepository(window.backendAPI);
    const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);
    return new MockServerService(mockServerRepository, statusDisplayAdapter);
}

export function initResponseEditor() {
    if (!responseEditor && responseBodyContainer) {
        responseEditor = new ResponseEditor(responseBodyContainer);

        // Set up callback to update dropdown when language changes
        responseEditor.onLanguageChange((languageType) => {
            if (languageSelector) {
                // Show the detected language type (e.g., 'json', 'xml', 'html')
                languageSelector.value = languageType || 'text';
            }
        });

        // Set up language selector event listener
        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLanguage = e.target.value;
                responseEditor.setLanguage(selectedLanguage);
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

        // Update preview management
        if (containerElements.previewManager && containerElements.tabId) {
            const language = containerElements.editor.currentLanguage;

            // Enable/disable preview button based on content type
            containerElements.previewManager.updateButtonState(containerElements.tabId, language);

            // Always update preview content if content is previewable, regardless of current view mode
            // This ensures preview is ready when user switches to it
            if (containerElements.previewManager.isPreviewable(language)) {
                containerElements.previewManager.refreshPreviewContent(containerElements.tabId, content, language);
            } else {
                // Clear preview for non-previewable content
                containerElements.previewManager.clearPreview(containerElements.tabId);
            }
        }
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
        const result = await window.backendAPI.cancelApiRequest();

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

    // Get URL from input - fall back to default attribute if value was cleared
    let url = urlInput?.value?.trim() || '';
    if (!url && urlInput) {
        // Fall back to the default value attribute if the current value is empty
        url = urlInput.getAttribute('value') || '';
    }

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

    // Create a single processor for the entire request to ensure dynamic variables
    // (like {{$uuid}}) resolve consistently throughout the request
    const processor = new VariableProcessor();
    processor.clearDynamicCache(); // Ensure fresh dynamic values for each new request

    // Always try to substitute variables (collection + environment or just environment)
    try {
        const variableService = getVariableService();
        let variables = {};

        if (window.currentEndpoint) {
            // Get collection-specific variables + environment variables
            const collectionRepository = new CollectionRepository(window.backendAPI);
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

        // First, substitute variables in path param VALUES (so {{var}} in path params get replaced)
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        // Then substitute variables in URL (include processed path params)
        const combinedVariables = { ...variables, ...processedPathParams };
        url = processor.processTemplate(url, combinedVariables);

        // Auto-prepend https:// if no protocol is specified (after variable substitution)
        if (url && !url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            url = `https://${url}`;
        }

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
        updateStatusDisplay(`Variable processing error: ${error.message}`, null);
        return;
    }

    // Strip existing query params from URL and rebuild from query params list
    // This prevents duplication since updateUrlFromQueryParams() already shows them in the URL field
    const urlWithoutQuery = url.split('?')[0];

    // Build query string manually to preserve exact encoding
    // URLSearchParams over-encodes some characters (e.g., %2F -> %252F)
    const queryPairs = [];
    for (const [key, value] of Object.entries(queryParams)) {
        if (key) {
            // Only encode if not already encoded, by checking for % signs
            // If value contains %, assume it's already encoded and use as-is
            const encodedValue = value.includes('%') ? value : encodeURIComponent(value);
            const encodedKey = key.includes('%') ? key : encodeURIComponent(key);
            queryPairs.push(`${encodedKey}=${encodedValue}`);
        }
    }

    const queryString = queryPairs.join('&');
    if (queryString) {
        url = `${urlWithoutQuery}?${queryString}`;
    } else {
        url = urlWithoutQuery;
    }

    // Check if mock server should be used for this request
    if (window.currentEndpoint) {
        try {
            const mockServerService = getMockServerService();
            const { shouldUseMock, mockBaseUrl } = await mockServerService.shouldUseMockServer(window.currentEndpoint.collectionId);
            
            if (shouldUseMock && mockBaseUrl) {
                // Get the endpoint path from the collection
                const collectionRepository = new CollectionRepository(window.backendAPI);
                const collection = await collectionRepository.getById(window.currentEndpoint.collectionId);
                
                if (collection) {
                    // Find the endpoint in the collection
                    let endpoint = collection.endpoints?.find(e => e.id === window.currentEndpoint.endpointId);
                    
                    // Also check folders if not found at top level
                    if (!endpoint && collection.folders) {
                        for (const folder of collection.folders) {
                            endpoint = folder.endpoints?.find(e => e.id === window.currentEndpoint.endpointId);
                            if (endpoint) { break; }
                        }
                    }
                    
                    if (endpoint && endpoint.path) {
                        // Replace path parameters in the endpoint path
                        let mockPath = endpoint.path;
                        for (const [key, value] of Object.entries(pathParams)) {
                            mockPath = mockPath.replace(`{${key}}`, value);
                        }
                        
                        // Build mock URL with query string
                        url = queryString ? `${mockBaseUrl}${mockPath}?${queryString}` : `${mockBaseUrl}${mockPath}`;
                    }
                }
            }
        } catch (error) {
            // Continue with original URL if mock server check fails
        }
    }

    // Handle request body (supports JSON and GraphQL modes)
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
            const variableService = getVariableService();
            let variables = {};

            if (window.currentEndpoint) {
                variables = await variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
            } else {
                variables = await variableService.getVariables();
            }

            // Note: reusing the same processor from above to maintain consistent dynamic variable values

            // Check if GraphQL mode is active
            if (graphqlBodyManager && graphqlBodyManager.isGraphQLMode()) {
                // GraphQL mode: construct { query, variables } body
                let queryText = graphqlBodyManager.getGraphQLQuery().trim();
                let variablesText = graphqlBodyManager.getGraphQLVariables().trim();

                // Apply variable substitution to query and variables
                queryText = processor.processTemplate(queryText, variables);
                variablesText = processor.processTemplate(variablesText, variables);

                // Parse variables JSON
                let parsedVariables = {};
                if (variablesText) {
                    try {
                        parsedVariables = JSON.parse(variablesText);
                    } catch (e) {
                        updateStatusDisplay(`Invalid GraphQL Variables JSON: ${e.message}`, null);
                        clearResponseDisplay();
                        responseHeadersDisplay.textContent = '';
                        return;
                    }
                }

                // Construct GraphQL request body
                body = {
                    query: queryText,
                    variables: parsedVariables
                };
            } else {
                // JSON mode: existing behavior
                let bodyText = getRequestBodyContent().trim();
                if (bodyText) {
                    bodyText = processor.processTemplate(bodyText, variables);

                    try {
                        body = JSON.parse(bodyText);
                    } catch (e) {
                        updateStatusDisplay(`Invalid Body JSON: ${e.message}`, null);
                        clearResponseDisplay();
                        responseHeadersDisplay.textContent = '';
                        return;
                    }
                }
            }
        } catch (e) {
            updateStatusDisplay(`Error processing request body: ${e.message}`, null);
            clearResponseDisplay();
            responseHeadersDisplay.textContent = '';
            return;
        }
    }

    // Get HTTP version and timeout settings
    let httpVersion = 'auto';
    let timeout = 30000; // Default 30 seconds
    try {
        const settings = await window.backendAPI.settings.get();
        httpVersion = settings.httpVersion || 'auto';
        // TimeoutManager saves as requestTimeout, store default uses timeout
        // 0 means no timeout - pass null to backend to disable timeout
        const savedTimeout = settings.requestTimeout ?? settings.timeout;
        timeout = savedTimeout === 0 ? null : (savedTimeout ?? 30000);
    } catch (e) {
        void e;
    }

    // Define requestConfig outside try block so it's accessible in catch block
    // Note: using let instead of const to allow pre-request scripts to modify the config
    let requestConfig = {
        method,
        url,
        headers,
        body,
        httpVersion,
        timeout
    };

    try {
        setRequestInProgress(true);

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

        // Execute pre-request script if exists
        if (window.currentEndpoint && window.scriptController) {
            try {
                requestConfig = await window.scriptController.executePreRequest(
                    window.currentEndpoint.collectionId,
                    window.currentEndpoint.endpointId,
                    requestConfig
                );
            } catch (error) {
                updateStatusDisplay(`Pre-request script error: ${error.message}`, null);
                // Continue anyway (non-blocking)
            }
        }

        const result = await window.backendAPI.sendApiRequest(requestConfig);

        if (result.success) {
            // Extract content-type from response headers
            let contentType = null;
            if (result.headers && result.headers['content-type']) {
                contentType = result.headers['content-type'];
            }

            // Format response based on content type
            // For text-based formats (HTML, XML, plain text, etc.), use raw string
            // For JSON and other structured data, use formatted JSON
            let formattedResponse;
            if (typeof result.data === 'string') {
                // Already a string (HTML, XML, plain text, etc.) - use as-is
                formattedResponse = result.data;
            } else {
                // Object or other data type - format as JSON
                formattedResponse = JSON.stringify(result.data, null, 2);
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

            // Execute test script if exists
            if (window.currentEndpoint && window.scriptController) {
                try {
                    await window.scriptController.executeTest(
                        window.currentEndpoint.collectionId,
                        window.currentEndpoint.endpointId,
                        requestConfig,
                        result
                    );
                } catch (error) {
                    // Non-blocking
                }
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

    // Create a single processor for the entire request to ensure dynamic variables
    // (like {{$uuid}}) resolve consistently throughout the request
    const processor = new VariableProcessor();
    processor.clearDynamicCache(); // Ensure fresh dynamic values for each new request

    // Always try to substitute variables (collection + environment or just environment)
    try {
        const variableService = getVariableService();
        let variables = {};

        if (window.currentEndpoint) {
            // Get collection-specific variables + environment variables
            const collectionRepository = new CollectionRepository(window.backendAPI);
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

        // First, substitute variables in path param VALUES (so {{var}} in path params get replaced)
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        // Then substitute variables in URL (include processed path params)
        const combinedVariables = { ...variables, ...processedPathParams };
        url = processor.processTemplate(url, combinedVariables);

        // Auto-prepend https:// if no protocol is specified (after variable substitution)
        if (url && !url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            url = `https://${url}`;
        }

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
        updateStatusDisplay(`Variable processing error: ${error.message}`, null);
        return;
    }

    const urlWithoutQuery = url.split('?')[0];

    // Build query string manually to preserve exact encoding (same as handleSendRequest)
    const queryPairs = [];
    for (const [key, value] of Object.entries(queryParams)) {
        if (key) {
            const encodedValue = value.includes('%') ? value : encodeURIComponent(value);
            const encodedKey = key.includes('%') ? key : encodeURIComponent(key);
            queryPairs.push(`${encodedKey}=${encodedValue}`);
        }
    }

    const queryString = queryPairs.join('&');
    if (queryString) {
        url = `${urlWithoutQuery}?${queryString}`;
    } else {
        url = urlWithoutQuery;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && getRequestBodyContent().trim()) {
        try {
            let bodyText = getRequestBodyContent().trim();

            // Always try to substitute variables in body (collection + environment or just environment)
            const variableService = getVariableService();
            let variables = {};

            if (window.currentEndpoint) {
                variables = await variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
            } else {
                variables = await variableService.getVariables();
            }

            // Note: reusing the same processor from above to maintain consistent dynamic variable values
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