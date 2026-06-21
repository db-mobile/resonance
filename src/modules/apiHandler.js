import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { urlInput, methodSelect, sendRequestBtn, cancelRequestBtn, responseBodyContainer, responseHeadersDisplay, responseCookiesDisplay, responsePerformanceDisplay, languageSelector } from './domElements.js';
import { toast } from './ui/Toast.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { saveAllRequestModifications } from './collectionManager.js';

let _saveDebounceTimer = null;
const SAVE_DEBOUNCE_MS = 500;

/**
 * Debounced, fire-and-forget save of request modifications.
 * Does not block the caller - saves happen asynchronously after a delay.
 * Multiple rapid calls will be coalesced into a single save.
 * 
 * @param {string} collectionId - Collection ID
 * @param {string} endpointId - Endpoint ID
 */
function debouncedSaveRequestModifications(collectionId, endpointId) {
    if (_saveDebounceTimer) {
        clearTimeout(_saveDebounceTimer);
    }
    _saveDebounceTimer = setTimeout(() => {
        _saveDebounceTimer = null;
        saveAllRequestModifications(collectionId, endpointId).catch(() => {
            toast.error('Failed to save changes');
        });
    }, SAVE_DEBOUNCE_MS);
}
import { VariableProcessor } from './variables/VariableProcessor.js';
import { VariableRepository } from './storage/VariableRepository.js';
import { EnvironmentRepository } from './storage/EnvironmentRepository.js';
import { CollectionRepository } from './storage/CollectionRepository.js';
import { VariableService } from './services/VariableService.js';
import { StatusDisplayAdapter } from './interfaces/IStatusDisplay.js';
import { authManager } from './authManager.js';
import { CodeSnippetDialog } from './ui/CodeSnippetDialog.js';
import { ResponseEditor } from './responseEditor.bundle.js';
import { extractCookies } from './cookieParser.js';
import { getRequestBodyContent } from './requestBodyHelper.js';
import { MockServerRepository } from './storage/MockServerRepository.js';
import { MockServerService } from './services/MockServerService.js';
import { isGrpcMode, isMqttMode, isSseMode, isWebSocketMode, isGraphQLMode } from './requestModeManager.js';
import { handleGrpcSend } from './grpcHandler.js';
import { handleWebSocketCancel, handleWebSocketSend } from './websocketHandler.js';
import { handleSseCancel, handleSseConnect } from './sseHandler.js';
import { handleMqttCancel, handleMqttSend } from './mqttHandler.js';
import {
    handleGraphQLSubscriptionStart,
    handleGraphQLSubscriptionCancel,
    isSubscriptionActive
} from './graphqlSubscriptionHandler.js';
import { selectActiveOperationType } from './graphqlTransportWs.js';
import { cancelStream as cancelGrpcStream, hasActiveStream as hasActiveGrpcStream } from './grpcStreamHandler.js';
import { RequestBuilderService } from './services/RequestBuilderService.js';
import { clearResponsePanes, displayResponsePanes, displayErrorResponsePanes } from './ResponseDisplayHelper.js';
import { getIntrospectionQuery, buildClientSchema } from 'graphql';

let responseEditor = null;

let graphqlBodyManager = null;

export function setGraphQLBodyManager(manager) {
    graphqlBodyManager = manager;
}

let _variableService = null;
let _mockServerService = null;
let _collectionRepository = null;
let _settingsCache = null;

export function invalidateSettingsCache() {
    _settingsCache = null;
}

export function invalidateEnvironmentCache() {
    if (_variableService?.environmentRepository) {
        _variableService.environmentRepository._cache = null;
    }
}

export function getSettingsCache() {
    return _settingsCache;
}

function getVariableService() {
    if (!_variableService) {
        const variableRepository = new VariableRepository(window.backendAPI, app.secretStore);
        const environmentRepository = new EnvironmentRepository(window.backendAPI, app.secretStore);
        const variableProcessor = new VariableProcessor();
        const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);
        _variableService = new VariableService(variableRepository, variableProcessor, statusDisplayAdapter, environmentRepository);
    }
    return _variableService;
}

function getMockServerService() {
    if (!_mockServerService) {
        const mockServerRepository = new MockServerRepository(window.backendAPI);
        const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);
        _mockServerService = new MockServerService(mockServerRepository, statusDisplayAdapter);
    }
    return _mockServerService;
}

function getCollectionRepository() {
    if (!_collectionRepository) {
        _collectionRepository = new CollectionRepository(window.backendAPI, app.secretStore);
    }
    return _collectionRepository;
}

let _requestBuilderService = null;
function getRequestBuilderService() {
    if (!_requestBuilderService) {
        _requestBuilderService = new RequestBuilderService(getVariableService, getCollectionRepository);
    }
    return _requestBuilderService;
}

/**
 * Fetches the GraphQL schema for the current endpoint by POSTing the standard
 * introspection query. Reuses the same URL/header/auth/variable resolution as the
 * main send path so it honours the user's configured auth, headers and variables.
 *
 * Does not mutate any shared send state and never throws — failures are returned
 * as { error }.
 *
 * @returns {Promise<{schema?: import('graphql').GraphQLSchema, url?: string, error?: string}>}
 */
export async function fetchGraphQLIntrospection() {
    const url = urlInput?.value?.trim() || urlInput?.getAttribute('value') || '';
    if (!url) {
        return { error: 'Enter a URL before fetching the schema' };
    }

    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const authData = authManager.generateAuthData();
    const builder = getRequestBuilderService();
    builder.mergeAuthData(headers, queryParams, authData);

    let resolvedUrl = url;
    try {
        const { variables, processor } = await builder.resolveVariables(getCurrentEndpoint(), headers);
        ({ url: resolvedUrl } = builder.processRequestComponents({
            url, pathParams: {}, headers, queryParams, variables, processor
        }));
    } catch (error) {
        return { error: `Variable processing error: ${error.message}` };
    }

    let timeout = 30000;
    let verifySsl = true;
    let followRedirects = true;
    try {
        if (!_settingsCache) {
            _settingsCache = await window.backendAPI.settings.get();
        }
        const settings = _settingsCache;
        const savedTimeout = settings.requestTimeout ?? settings.timeout;
        timeout = savedTimeout === 0 ? null : (savedTimeout ?? 30000);
        verifySsl = settings.verifySsl !== false;
        followRedirects = settings.followRedirects !== false;
    } catch (e) {
        void e;
    }

    const requestConfig = {
        method: 'POST',
        url: resolvedUrl,
        rawUrl: url,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: { query: getIntrospectionQuery(), variables: {} },
        timeout,
        verifySsl,
        followRedirects
    };

    if (authData.authConfig) {
        requestConfig.auth = authData.authConfig;
    }
    if (authData.awsAuth) {
        requestConfig.awsAuth = authData.awsAuth;
    }
    if (app.certificateController) {
        try {
            const clientCert = app.certificateController.getForHost(new URL(resolvedUrl).host);
            if (clientCert) {
                requestConfig.clientCert = clientCert;
            }
        } catch (e) {
            void e;
        }
    }

    let result;
    try {
        result = await window.backendAPI.sendApiRequest(requestConfig);
    } catch (error) {
        return { error: `Request failed: ${error.message || error}` };
    }

    if (!result || !result.success) {
        const status = result?.status ? ` (HTTP ${result.status})` : '';
        return { error: `${result?.message || 'Introspection request failed'}${status}` };
    }

    const payload = result.data;
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
        return { error: `GraphQL error: ${payload.errors[0].message || 'introspection rejected'}` };
    }

    const introspection = payload?.data;
    if (!introspection || !introspection.__schema) {
        return { error: 'Response did not contain a GraphQL schema (introspection may be disabled)' };
    }

    try {
        return { schema: buildClientSchema(introspection), introspection, url: resolvedUrl };
    } catch (error) {
        return { error: `Could not parse schema: ${error.message}` };
    }
}

/**
 * Rebuild a GraphQLSchema from a previously fetched (and persisted) raw
 * introspection result. Used by the autocomplete cache load path.
 *
 * @param {object} introspection - The `data` payload of an introspection query.
 * @returns {import('graphql').GraphQLSchema|null} The schema, or null if invalid.
 */
export function buildSchemaFromIntrospection(introspection) {
    if (!introspection || !introspection.__schema) {
        return null;
    }
    try {
        return buildClientSchema(introspection);
    } catch (_error) {
        return null;
    }
}

/**
 * Returns the global DOM element references used as fallbacks
 * when per-tab response containers are not available.
 */
function globalResponseElements() {
    return {
        headersDisplay: responseHeadersDisplay,
        cookiesDisplay: responseCookiesDisplay,
        performanceDisplay: responsePerformanceDisplay
    };
}

export function initResponseEditor() {
    if (!responseEditor && responseBodyContainer) {
        responseEditor = new ResponseEditor(responseBodyContainer);

        responseEditor.onLanguageChange((languageType) => {
            if (languageSelector) {
                languageSelector.value = languageType || 'text';
            }
        });

        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLanguage = e.target.value;
                responseEditor.setLanguage(selectedLanguage);
            });
        }
    }
}

async function isTabCurrentlyActive(tabId) {
    if (!tabId || !app.workspaceTabController) {
        return true;
    }
    const activeTabId = await app.workspaceTabController.service.getActiveTabId();
    return activeTabId === tabId;
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
    return displayResponseWithLineNumbersForTab(content, contentType, null);
}

/**
 * Clears the schema validation badge from the response area
 * @param {string|null} tabId - Workspace tab ID
 */
export function clearSchemaValidationBadge(tabId = null) {
    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    const statusContainer = containerElements?.statusContainer || document.querySelector('.status-info-container');
    if (!statusContainer) {
        return;
    }

    const existingBadge = statusContainer.querySelector('.response-validation-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
}

/**
 * Displays schema validation result in the response area
 * @param {Object} validationResult - { valid: boolean, errors: Array, hasSchema: boolean }
 * @param {string|null} tabId - Workspace tab ID
 */
function displaySchemaValidationResult(validationResult, tabId = null) {
    clearSchemaValidationBadge(tabId);

    if (!validationResult.hasSchema) {
        return;
    }

    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    const statusContainer = containerElements?.statusContainer || document.querySelector('.status-info-container');
    if (!statusContainer) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = `status-badge response-validation-badge ${validationResult.valid ? 'is-success' : 'is-error'}`;
    badge.textContent = validationResult.valid ? 'Schema Valid' : `Schema Invalid (${validationResult.errors.length})`;

    if (!validationResult.valid && validationResult.errors.length > 0) {
        badge.title = validationResult.errors.map(e => `${e.path}: ${e.message}`).join('\n');
    }

    statusContainer.appendChild(badge);
}

/**
 * Removes the GraphQL errors badge from the response status area.
 * @param {string|null} tabId - Workspace tab ID
 */
export function clearGraphQLErrorsBadge(tabId = null) {
    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    const statusContainer = containerElements?.statusContainer || document.querySelector('.status-info-container');
    const existingBadge = statusContainer?.querySelector('.graphql-errors-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
}

/**
 * Surfaces top-level GraphQL `errors` from a response. GraphQL servers return
 * HTTP 200 even when a query fails, so without this a failed query looks like a
 * successful request. Only acts when the request was sent in GraphQL mode.
 *
 * @param {Object} result - The backend ApiResponse (result.data is the parsed body)
 * @param {string|null} tabId - Workspace tab ID
 */
function displayGraphQLErrorsBadge(result, tabId = null) {
    clearGraphQLErrorsBadge(tabId);

    if (!graphqlBodyManager || !graphqlBodyManager.isGraphQLMode()) {
        return;
    }

    const data = result?.data;
    const errors = (data && typeof data === 'object' && !Array.isArray(data)) ? data.errors : null;
    if (!Array.isArray(errors) || errors.length === 0) {
        return;
    }

    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    const statusContainer = containerElements?.statusContainer || document.querySelector('.status-info-container');
    if (!statusContainer) {
        return;
    }

    const badge = document.createElement('span');
    badge.className = 'status-badge graphql-errors-badge is-error';
    badge.textContent = `GraphQL Errors (${errors.length})`;
    badge.title = errors
        .map(e => (e && typeof e.message === 'string') ? e.message : JSON.stringify(e))
        .join('\n');

    statusContainer.appendChild(badge);
}

export function displayResponseWithLineNumbersForTab(content, contentType = null, tabId = null, languageHint = undefined) {
    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    if (containerElements && containerElements.editor) {
        containerElements.editor.setContent(content, contentType, languageHint);

        if (containerElements.previewManager && containerElements.tabId) {
            const language = containerElements.editor.currentLanguage;

            containerElements.previewManager.updateButtonState(containerElements.tabId, language);

            if (containerElements.previewManager.isPreviewable(language)) {
                containerElements.previewManager.refreshPreviewContent(containerElements.tabId, content, language);
            } else {
                containerElements.previewManager.clearPreview(containerElements.tabId);
            }
        }
    } else {
        initResponseEditor();
        if (responseEditor) {
            responseEditor.setContent(content, contentType, languageHint);
        }
    }
}

export function clearResponseDisplay() {
    return clearResponseDisplayForTab(null);
}

export function clearResponseDisplayForTab(tabId = null) {
    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    if (containerElements && containerElements.editor) {
        containerElements.editor.clear();
    } else {
        initResponseEditor();
        if (responseEditor) {
            responseEditor.clear();
        }
    }
}

export function setRequestInProgress(inProgress) {
    if (inProgress) {
        sendRequestBtn.style.display = 'none';
        cancelRequestBtn.style.display = 'inline-block';
        sendRequestBtn.disabled = true;
    } else {
        sendRequestBtn.style.display = 'inline-block';
        cancelRequestBtn.style.display = 'none';
        sendRequestBtn.disabled = false;
    }
    app.statusBar?.setRequestRunning(inProgress);
}

export async function handleCancelRequest() {
    if (isWebSocketMode()) {
        await handleWebSocketCancel();
        setRequestInProgress(false);
        return;
    }

    if (isSseMode()) {
        await handleSseCancel();
        setRequestInProgress(false);
        return;
    }

    if (isMqttMode()) {
        await handleMqttCancel();
        setRequestInProgress(false);
        return;
    }

    if (isGrpcMode()) {
        const tabId = app.workspaceTabController
            ? await app.workspaceTabController.service.getActiveTabId()
            : null;
        if (tabId && hasActiveGrpcStream(tabId)) {
            await cancelGrpcStream(tabId);
            setRequestInProgress(false);
            return;
        }
    }

    try {
        const requestTabId = app.workspaceTabController
            ? await app.workspaceTabController.service.getActiveTabId()
            : null;

        const result = await window.backendAPI.cancelApiRequest();

        if (result.success) {
            if (await isTabCurrentlyActive(requestTabId)) {
                updateStatusDisplay('Request cancelled', null);
                updateResponseTime(null);
                updateResponseSize(null);
            }
            displayResponseWithLineNumbersForTab('Request was cancelled by user', null, requestTabId);
            clearResponsePanes(requestTabId, globalResponseElements());
        }
    } catch (error) {
        updateStatusDisplay('Error cancelling request', null);
        updateResponseTime(null);
        updateResponseSize(null);
    } finally {
        setRequestInProgress(false);
    }
}

/**
 * Determine the operation type the Run button should execute in GraphQL mode,
 * based on the editor's parsed operations and the operation picker selection.
 * @returns {string|null} 'query' | 'mutation' | 'subscription' | null
 */
function getActiveGraphQLOperationType() {
    if (!graphqlBodyManager) {
        return null;
    }
    const operations = graphqlBodyManager.graphqlEditor?.getOperations?.() || null;
    const selected = graphqlBodyManager.getSelectedOperationName?.() || null;
    return selectActiveOperationType(operations, selected);
}

/**
 * Open (or toggle off) a GraphQL subscription over WebSocket. Resolves variables,
 * headers, auth and the query exactly like the HTTP send path before connecting.
 */
async function handleGraphQLSubscriptionRequest() {
    const tabId = app.workspaceTabController
        ? await app.workspaceTabController.service.getActiveTabId()
        : null;

    if (tabId && isSubscriptionActive(tabId)) {
        await handleGraphQLSubscriptionCancel();
        return;
    }

    if (getCurrentEndpoint()) {
        debouncedSaveRequestModifications(getCurrentEndpoint().collectionId, getCurrentEndpoint().endpointId);
    }

    let url = urlInput?.value?.trim() || urlInput?.getAttribute('value') || '';
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));
    const authData = authManager.generateAuthData();
    const builder = getRequestBuilderService();
    builder.mergeAuthData(headers, queryParams, authData);

    let query = graphqlBodyManager.getGraphQLQuery().trim();
    const variablesText = graphqlBodyManager.getGraphQLVariables().trim();
    const operationName = graphqlBodyManager.getSelectedOperationName?.() || null;

    try {
        const { variables, processor } = await builder.resolveVariables(getCurrentEndpoint(), headers);
        ({ url } = builder.processRequestComponents({
            url, pathParams: {}, headers, queryParams, variables, processor
        }));
        query = processor.processTemplate(query, variables);

        let parsedVariables = {};
        if (variablesText) {
            const resolvedVarsText = processor.processTemplate(variablesText, variables);
            try {
                parsedVariables = JSON.parse(resolvedVarsText);
            } catch (e) {
                toast.error(`Invalid GraphQL Variables JSON: ${e.message}`);
                return;
            }
        }

        await handleGraphQLSubscriptionStart({
            url, headers, query, variables: parsedVariables, operationName
        });
    } catch (error) {
        updateStatusDisplay(`Variable processing error: ${error.message}`, null);
    }
}

export async function handleSendRequest() {
    if (isGrpcMode()) {
        return handleGrpcSend();
    }

    if (isGraphQLMode()) {
        const gqlTabId = app.workspaceTabController
            ? await app.workspaceTabController.service.getActiveTabId()
            : null;
        if ((gqlTabId && isSubscriptionActive(gqlTabId))
            || getActiveGraphQLOperationType() === 'subscription') {
            return handleGraphQLSubscriptionRequest();
        }
    }

    if (isWebSocketMode()) {
        if (getCurrentEndpoint()) {
            debouncedSaveRequestModifications(getCurrentEndpoint().collectionId, getCurrentEndpoint().endpointId);
        }

        let websocketUrl = urlInput?.value?.trim() || '';
        if (!websocketUrl && urlInput) {
            websocketUrl = urlInput.getAttribute('value') || '';
        }

        const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));
        const headers = parseKeyValuePairs(document.getElementById('headers-list'));
        const authData = authManager.generateAuthData();

        const builder = getRequestBuilderService();
        builder.mergeAuthData(headers, queryParams, authData);

        try {
            const { variables, processor } = await builder.resolveVariables(
                getCurrentEndpoint(), headers
            );

            const result = builder.processRequestComponents({
                url: websocketUrl,
                pathParams: {},
                headers,
                queryParams,
                variables,
                processor
            });
            websocketUrl = result.url;
        } catch (error) {
            updateStatusDisplay(`Variable processing error: ${error.message}`, null);
            return;
        }

        setRequestInProgress(true);
        try {
            await handleWebSocketSend(websocketUrl, headers);
        } finally {
            setRequestInProgress(false);
        }
        return;
    }

    if (isSseMode()) {
        if (getCurrentEndpoint()) {
            debouncedSaveRequestModifications(getCurrentEndpoint().collectionId, getCurrentEndpoint().endpointId);
        }

        const sseInput = document.getElementById('sse-url-input');
        let sseUrl = sseInput?.value?.trim() || urlInput?.value?.trim() || '';

        const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));
        const headers = parseKeyValuePairs(document.getElementById('headers-list'));
        const authData = authManager.generateAuthData();

        const builder = getRequestBuilderService();
        builder.mergeAuthData(headers, queryParams, authData);

        try {
            const { variables, processor } = await builder.resolveVariables(
                getCurrentEndpoint(), headers
            );
            const result = builder.processRequestComponents({
                url: sseUrl,
                pathParams: {},
                headers,
                queryParams,
                variables,
                processor
            });
            sseUrl = result.url;
        } catch (error) {
            updateStatusDisplay(`Variable processing error: ${error.message}`, null);
            return;
        }

        setRequestInProgress(true);
        try {
            await handleSseConnect(sseUrl, headers);
        } finally {
            setRequestInProgress(false);
        }
        return;
    }

    if (isMqttMode()) {
        if (getCurrentEndpoint()) {
            debouncedSaveRequestModifications(getCurrentEndpoint().collectionId, getCurrentEndpoint().endpointId);
        }

        const brokerInput = document.getElementById('mqtt-broker-input');
        let broker = brokerInput?.value?.trim() || urlInput?.value?.trim() || '';

        const builder = getRequestBuilderService();
        try {
            const { variables, processor } = await builder.resolveVariables(
                getCurrentEndpoint(), {}
            );
            const result = builder.processRequestComponents({
                url: broker,
                pathParams: {},
                headers: {},
                queryParams: {},
                variables,
                processor
            });
            broker = result.url;
        } catch (error) {
            updateStatusDisplay(`Variable processing error: ${error.message}`, null);
            return;
        }

        setRequestInProgress(true);
        try {
            await handleMqttSend(broker, {
                clientId: document.getElementById('mqtt-client-id-input')?.value?.trim() || '',
                username: document.getElementById('mqtt-username-input')?.value || '',
                password: document.getElementById('mqtt-password-input')?.value || '',
                subscribeTopic: document.getElementById('mqtt-subscribe-input')?.value?.trim() || '',
                publishTopic: document.getElementById('mqtt-topic-input')?.value?.trim() || '',
                qos: Number(document.getElementById('mqtt-qos-select')?.value) || 0,
                payload: getRequestBodyContent() || ''
            });
        } finally {
            setRequestInProgress(false);
        }
        return;
    }

    setRequestInProgress(true);

    if (getCurrentEndpoint()) {
        debouncedSaveRequestModifications(getCurrentEndpoint().collectionId, getCurrentEndpoint().endpointId);
    }

    let url = urlInput?.value?.trim() || '';
    if (!url && urlInput) {
        url = urlInput.getAttribute('value') || '';
    }

    const rawUrl = url;

    const method = isGraphQLMode() ? 'POST' : methodSelect.value;
    let body = undefined;

    const pathParams = parseKeyValuePairs(document.getElementById('path-params-list'));
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const authData = authManager.generateAuthData();

    const builder = getRequestBuilderService();
    builder.mergeAuthData(headers, queryParams, authData);

    let processor;
    let _resolvedVariables = null;
    let queryString = '';
    try {
        ({ variables: _resolvedVariables, processor } = await builder.resolveVariables(
            getCurrentEndpoint(), headers
        ));

        ({ url, queryString } = builder.processRequestComponents({
            url, pathParams, headers, queryParams,
            variables: _resolvedVariables,
            processor
        }));
    } catch (error) {
        updateStatusDisplay(`Variable processing error: ${error.message}`, null);
        setRequestInProgress(false);
        return;
    }

    if (getCurrentEndpoint()) {
        try {
            const mockServerService = getMockServerService();
            const { shouldUseMock, mockBaseUrl } = await mockServerService.shouldUseMockServer(getCurrentEndpoint().collectionId);
            
            if (shouldUseMock && mockBaseUrl) {
                const collection = await getCollectionRepository().getById(getCurrentEndpoint().collectionId);
                
                if (collection) {
                    let endpoint = collection.endpoints?.find(e => e.id === getCurrentEndpoint().endpointId);
                    
                    if (!endpoint && collection.folders) {
                        for (const folder of collection.folders) {
                            endpoint = folder.endpoints?.find(e => e.id === getCurrentEndpoint().endpointId);
                            if (endpoint) { break; }
                        }
                    }
                    
                    if (endpoint && endpoint.path) {
                        let mockPath = endpoint.path;
                        for (const [key, value] of Object.entries(pathParams)) {
                            mockPath = mockPath.replace(`{${key}}`, value);
                        }

                        url = queryString ? `${mockBaseUrl}${mockPath}?${queryString}` : `${mockBaseUrl}${mockPath}`;
                    }
                }
            }
        } catch (error) {
        }
    }

    const bodyMode = document.getElementById('body-mode-select')?.value || 'json';
    if (['POST', 'PUT', 'PATCH'].includes(method) || bodyMode === 'formdata' || bodyMode === 'urlencoded') {
        try {
            let variables = _resolvedVariables;
            if (variables === null) {
                const variableService = getVariableService();
                if (getCurrentEndpoint()) {
                    variables = await variableService.getVariablesForCollection(getCurrentEndpoint().collectionId);
                } else {
                    variables = await variableService.getVariables();
                }
            }

            if (isGraphQLMode() && graphqlBodyManager) {
                let queryText = graphqlBodyManager.getGraphQLQuery().trim();
                let variablesText = graphqlBodyManager.getGraphQLVariables().trim();

                queryText = processor.processTemplate(queryText, variables);
                variablesText = processor.processTemplate(variablesText, variables);

                let parsedVariables = {};
                if (variablesText) {
                    try {
                        parsedVariables = JSON.parse(variablesText);
                    } catch (e) {
                        toast.error(`Invalid GraphQL Variables JSON: ${e.message}`);
                        clearResponseDisplay();
                        setRequestInProgress(false);
                        return;
                    }
                }

                body = {
                    query: queryText,
                    variables: parsedVariables
                };

                const operationName = graphqlBodyManager.getSelectedOperationName?.();
                if (operationName) {
                    body.operationName = operationName;
                }
            } else if ((bodyMode === 'formdata' || bodyMode === 'urlencoded') && app.formBodyManager) {
                const rawFields = bodyMode === 'formdata'
                    ? app.formBodyManager.getFormDataFields()
                    : app.formBodyManager.getUrlencodedFields();
                const processed = {};
                for (const [k, v] of Object.entries(rawFields)) {
                    processed[processor.processTemplate(k, variables)]
                        = processor.processTemplate(v, variables);
                }
                if (Object.keys(processed).length > 0) {
                    body = processed;
                }
            } else if (bodyMode === 'text') {
                const rawText = app.requestBodyTextEditor
                    ? app.requestBodyTextEditor.getContent()
                    : '';
                if (rawText) {
                    body = processor.processTemplate(rawText, variables);
                }
            } else {
                let bodyText = getRequestBodyContent().trim();
                if (bodyText) {
                    bodyText = processor.processTemplate(bodyText, variables);

                    try {
                        body = JSON.parse(bodyText);
                    } catch (e) {
                        toast.error(`Invalid Body JSON: ${e.message}`);
                        clearResponseDisplay();
                        setRequestInProgress(false);
                        return;
                    }
                }
            }
        } catch (e) {
            toast.error(`Error processing request body: ${e.message}`);
            clearResponseDisplay();
            setRequestInProgress(false);
            return;
        }
    }

    let httpVersion = 'auto';
    let timeout = 30000;
    let verifySsl = true;
    let followRedirects = true;
    try {
        if (!_settingsCache) {
            _settingsCache = await window.backendAPI.settings.get();
        }
        const settings = _settingsCache;
        httpVersion = settings.httpVersion || 'auto';
        const savedTimeout = settings.requestTimeout ?? settings.timeout;
        timeout = savedTimeout === 0 ? null : (savedTimeout ?? 30000);
        verifySsl = settings.verifySsl !== false;
        followRedirects = settings.followRedirects !== false;
    } catch (e) {
        void e;
    }

    let requestConfig = {
        method,
        url,
        rawUrl,
        headers,
        body,
        bodyType: (bodyMode === 'formdata' || bodyMode === 'urlencoded' || bodyMode === 'text') ? bodyMode : undefined,
        httpVersion,
        timeout,
        verifySsl,
        followRedirects
    };

    if (app.certificateController) {
        try {
            const clientCert = app.certificateController.getForHost(new URL(url).host);
            if (clientCert) {
                requestConfig.clientCert = clientCert;
            }
        } catch (e) {
            void e;
        }
    }

    const requestTabId = app.workspaceTabController
        ? await app.workspaceTabController.service.getActiveTabId()
        : null;

    try {
        await new Promise(resolve => requestAnimationFrame(resolve));

        displayResponseWithLineNumbersForTab('Sending request...', null, requestTabId);

        clearResponsePanes(requestTabId, globalResponseElements());

        if (authData.authConfig) {
            requestConfig.auth = authData.authConfig;
        }

        if (authData.awsAuth) {
            requestConfig.awsAuth = authData.awsAuth;
        }

        if (getCurrentEndpoint() && app.scriptController) {
            try {
                requestConfig = await app.scriptController.executePreRequest(
                    getCurrentEndpoint().collectionId,
                    getCurrentEndpoint().endpointId,
                    requestConfig
                );
            } catch (error) {
                updateStatusDisplay(`Pre-request script error: ${error.message}`, null);
            }
        }

        if (app.cookieController) {
            const cookieHeader = await app.cookieController.getCookieHeader(url);
            if (cookieHeader) {
                requestConfig.headers = requestConfig.headers || {};
                if (!requestConfig.headers['Cookie'] && !requestConfig.headers['cookie']) {
                    requestConfig.headers['Cookie'] = cookieHeader;
                }
            }
        }

        const result = await window.backendAPI.sendApiRequest(requestConfig);

        if (result.success) {
            let contentType = null;
            if (result.headers && result.headers['content-type']) {
                contentType = result.headers['content-type'];
            }

            let formattedResponse;
            let languageHint;
            if (typeof result.data === 'string') {
                formattedResponse = result.data;
            } else {
                formattedResponse = JSON.stringify(result.data, null, 2);
                languageHint = 'json';
            }

            displayResponseWithLineNumbersForTab(formattedResponse, contentType, requestTabId, languageHint);

            if (app.schemaController) {
                app.schemaController.setLastResponseBody(result.data);
                const validationResult = app.schemaController.validateResponse(result.data);
                displaySchemaValidationResult(validationResult, requestTabId);
            }

            displayGraphQLErrorsBadge(result, requestTabId);

            displayResponsePanes(requestTabId, globalResponseElements(), {
                headers: result.headers,
                timings: result.timings,
                size: result.size
            });

            if (app.cookieController && result.setCookies && result.setCookies.length > 0) {
                app.cookieController.handleCookiesFromResponse(result.setCookies, url);
            }

            updateStatusDisplay(`Status: ${result.status} ${result.statusText}`, result.status);
            updateResponseTime(result.ttfb);
            updateResponseSize(result.size);
            setRequestInProgress(false);

            if (app.workspaceTabController && requestTabId) {
                app.workspaceTabController.service.updateTab(requestTabId, {
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
                }).catch(() => { });
                if (app.workspaceTabController.tabBar?.updateTab) {
                    app.workspaceTabController.tabBar.updateTab(requestTabId, { isModified: false });
                }
            }

            if (app.historyController) {
                const _activeEnvName = await app.environmentController?.service?.getActiveEnvironment().then(e => e?.name || null).catch(() => null) || null;
                app.historyController.addHistoryEntry(requestConfig, result, getCurrentEndpoint(), _activeEnvName).catch(() => { });
            }

            if (getCurrentEndpoint() && app.scriptController) {
                try {
                    await app.scriptController.executeTest(
                        getCurrentEndpoint().collectionId,
                        getCurrentEndpoint().endpointId,
                        requestConfig,
                        result
                    );
                } catch (error) {
                }
            }
        } else if (result.cancelled) {
            if (await isTabCurrentlyActive(requestTabId)) {
                updateStatusDisplay('Request cancelled', null);
                updateResponseTime(null);
                updateResponseSize(null);
            }
            displayResponseWithLineNumbersForTab('Request was cancelled', null, requestTabId);
            clearResponsePanes(requestTabId, globalResponseElements());
            clearGraphQLErrorsBadge(requestTabId);
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

        let contentType = null;
        if (error.headers && error.headers['content-type']) {
            contentType = error.headers['content-type'];
        }

        displayResponseWithLineNumbersForTab(errorContent, contentType, requestTabId);

        displayErrorResponsePanes(requestTabId, globalResponseElements(), error);
        clearGraphQLErrorsBadge(requestTabId);

        let statusDisplayText = 'Request Failed';
        if (status) {
            statusDisplayText = `${status}${statusText ? ` ${statusText}` : ''}`;
        }

        if (await isTabCurrentlyActive(requestTabId)) {
            updateStatusDisplay(statusDisplayText, status);
            updateResponseTime(error.ttfb);
            updateResponseSize(error.size);
        }

        if (app.historyController) {
            const _activeEnvName = await app.environmentController?.service?.getActiveEnvironment().then(e => e?.name || null).catch(() => null) || null;
            app.historyController.addHistoryEntry(requestConfig, error, getCurrentEndpoint(), _activeEnvName).catch(() => { });
        }

        if (getCurrentEndpoint() && app.scriptController) {
            try {
                await app.scriptController.executeTest(
                    getCurrentEndpoint().collectionId,
                    getCurrentEndpoint().endpointId,
                    requestConfig,
                    error
                );
            } catch (e) {
            }
        }
    } finally {
        setRequestInProgress(false);
    }
}

export async function handleGenerateCurl() {
    if (getCurrentEndpoint()) {
        debouncedSaveRequestModifications(getCurrentEndpoint().collectionId, getCurrentEndpoint().endpointId);
    }

    let url = urlInput.value.trim();

    const method = methodSelect.value;
    let body = undefined;

    const pathParams = parseKeyValuePairs(document.getElementById('path-params-list'));
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const authData = authManager.generateAuthData();

    const builder = getRequestBuilderService();
    builder.mergeAuthData(headers, queryParams, authData);

    let processor;
    let resolvedVariables;
    try {
        ({ variables: resolvedVariables, processor } = await builder.resolveVariables(
            getCurrentEndpoint(), headers
        ));

        ({ url } = builder.processRequestComponents({
            url, pathParams, headers, queryParams,
            variables: resolvedVariables,
            processor
        }));
    } catch (error) {
        updateStatusDisplay(`Variable processing error: ${error.message}`, null);
        return;
    }

    if (['POST', 'PUT', 'PATCH'].includes(method) && getRequestBodyContent().trim()) {
        try {
            let bodyText = getRequestBodyContent().trim();

            const variableService = getVariableService();
            let variables = {};

            if (getCurrentEndpoint()) {
                variables = await variableService.getVariablesForCollection(getCurrentEndpoint().collectionId);
            } else {
                variables = await variableService.getVariables();
            }

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
