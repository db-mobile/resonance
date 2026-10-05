import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { urlInput, methodSelect, sendRequestBtn, cancelRequestBtn, responseBodyContainer, responseHeadersDisplay, responseCookiesDisplay, responsePerformanceDisplay, languageSelector } from './domElements.js';
import { toast } from './ui/Toast.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs, parseKeyValueRows } from './keyValueManager.js';
import { saveAllRequestModifications } from './collectionManager.js';
import { debounce } from './utils/debounce.js';
import { findRequest } from './collections/collectionTree.js';
import { buildMockPath } from './collections/endpointUrl.js';
import { methodCarriesBody, requestSendsBody } from './utils/bodyMethods.js';
import { inFlightRequestFor, newRequestId, trackInFlight } from './state/inFlightRequests.js';
import { registerPendingSave } from './state/pendingSaves.js';
import { resolveRequestSettings } from './state/settingsCache.js';

const SAVE_DEBOUNCE_MS = 500;

let inFlightRequestSave = null;

/**
 * @param {string} collectionId
 * @param {string} endpointId
 */
const debouncedSaveRequestModifications = debounce((collectionId, endpointId) => {
    inFlightRequestSave = saveAllRequestModifications(collectionId, endpointId)
        .catch(() => {
            toast.error('Failed to save changes');
        })
        .finally(() => {
            inFlightRequestSave = null;
        });
    return inFlightRequestSave;
}, SAVE_DEBOUNCE_MS);

/** @returns {Promise<void>} */
async function flushPendingRequestSave() {
    await debouncedSaveRequestModifications.flush();
    await inFlightRequestSave;
}

/** @returns {void} */
function cancelPendingRequestSave() {
    debouncedSaveRequestModifications.cancel();
}

registerPendingSave({ flush: flushPendingRequestSave, cancel: cancelPendingRequestSave });
import { VariableProcessor } from './variables/VariableProcessor.js';
import { VariableRepository } from './storage/VariableRepository.js';
import { EnvironmentRepository } from './storage/EnvironmentRepository.js';
import { CollectionRepository } from './storage/CollectionRepository.js';
import { VariableService } from './services/VariableService.js';
import { StatusDisplayAdapter } from './interfaces/IStatusDisplay.js';
import { authManager, setOAuthVariableResolver } from './authManager.js';
import { resolveEffectiveAuthWithSource } from './auth/authInheritance.js';
import { ensureFreshOAuthToken, oauthRefreshKey } from './auth/oauthRefresh.js';
import { resolveAuthConfigVariables } from './auth/authVariables.js';
import { CodeSnippetDialog } from './ui/CodeSnippetDialog.js';
import { createLazyEditorProxy } from './editorLoader.js';
import { responseCookies } from './cookieParser.js';
import { getRequestBodyContent, captureSnippetBody } from './requestBodyHelper.js';
import { MockServerRepository } from './storage/MockServerRepository.js';
import { MockServerService } from './services/MockServerService.js';
import { isGrpcMode, isGraphQLMode, getCurrentMode, RequestMode } from './requestModeManager.js';
import { getProtocol } from './protocols/protocolRegistry.js';
import { handleGrpcSend } from './grpcHandler.js';
import { handleWebSocketCancel, handleWebSocketSend, isWebSocketLive } from './websocketHandler.js';
import { handleSseCancel, handleSseConnect, isSseLive } from './sseHandler.js';
import { handleMqttCancel, handleMqttSend } from './mqttHandler.js';
import {
    handleGraphQLSubscriptionStart,
    handleGraphQLSubscriptionCancel,
    isSubscriptionActive
} from './graphqlSubscriptionHandler.js';
import { selectActiveOperationType } from './graphqlTransportWs.js';
import { cancelStream as cancelGrpcStream, hasActiveStream as hasActiveGrpcStream, isGrpcStreamLive } from './grpcStreamHandler.js';
import { STREAM_STATE_EVENT } from './streaming/streamState.js';
import { getActiveTabId, isTabCurrentlyActive, showStatusIfActive } from './streaming/streamSession.js';
import { translate } from './utils/translate.js';
import { RequestBuilderService } from './services/RequestBuilderService.js';
import { clearResponsePanes, displayResponsePanes, displayErrorResponsePanes, responseContainerFor } from './ResponseDisplayHelper.js';
import { setResponseMeta, suggestedFileName } from './responseSaver.js';
import { getIntrospectionQuery, buildClientSchema } from 'graphql';

let responseEditor = null;

let graphqlBodyManager = null;

export function setGraphQLBodyManager(manager) {
    graphqlBodyManager = manager;
}

let _variableService = null;
let _mockServerService = null;
let _collectionRepository = null;

export function invalidateEnvironmentCache() {
    if (_variableService?.environmentRepository) {
        _variableService.environmentRepository._cache = null;
    }
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
export function getRequestBuilderService() {
    if (!_requestBuilderService) {
        _requestBuilderService = new RequestBuilderService(getVariableService, getCollectionRepository);
    }
    return _requestBuilderService;
}

setOAuthVariableResolver((collectionId) => {
    const endpoint = collectionId ? { collectionId } : getCurrentEndpoint();
    return getRequestBuilderService().resolveVariables(endpoint, {});
});

/**
 * @param {{variables?: Object, processor?: Object, refreshOAuth?: boolean}} [substitution]
 * @returns {Promise<Object>}
 */
export async function generateEffectiveAuthData({ variables, processor, refreshOAuth = true } = {}) {
    const current = getCurrentEndpoint();
    const repository = getCollectionRepository();
    const { authConfig: resolved, source } = await resolveEffectiveAuthWithSource(authManager.getAuthConfig(), {
        collectionId: current?.collectionId,
        endpointId: current?.endpointId,
        repository
    });
    const substituted = resolveAuthConfigVariables(resolved, variables, processor);
    const { unresolved } = substituted;
    let effective = substituted.authConfig;

    if (refreshOAuth && source) {
        const renewal = await ensureFreshOAuthToken({
            rawAuth: resolved,
            resolvedAuth: effective,
            key: oauthRefreshKey(current, source),
            getToken: (request) => window.backendAPI.oauth2.getToken(request),
            persist: async (nextRaw, result) => {
                if (source.kind === 'request') {
                    authManager.applyTokenResult(result);
                    scheduleEndpointSave();
                } else if (current?.collectionId) {
                    await repository.saveAuthConfigAtSource(current.collectionId, current.endpointId, source, nextRaw);
                }
            }
        });
        effective = renewal.resolvedAuth;
        if (renewal.error) {
            toast.warning(renewal.error);
        }
    }

    const authData = authManager.generateAuthData(effective);
    authData.unresolvedVariables = unresolved;
    return authData;
}

/**
 * @param {Object} requestConfig
 * @param {{authConfig?: Object, awsAuth?: Object, ntlmAuth?: Object}} authData
 * @returns {void}
 */
function attachAuthTransport(requestConfig, authData) {
    if (authData.authConfig) {
        requestConfig.auth = authData.authConfig;
    }
    if (authData.awsAuth) {
        requestConfig.awsAuth = authData.awsAuth;
    }
    if (authData.ntlmAuth) {
        requestConfig.ntlm = authData.ntlmAuth;
    }
}

/**
 * @param {{url: string, clientCert?: Object}} requestConfig
 * @returns {void}
 */
function attachClientCert(requestConfig) {
    if (!app.certificateController) {
        return;
    }
    try {
        const clientCert = app.certificateController.getForHost(new URL(requestConfig.url).host);
        if (clientCert) {
            requestConfig.clientCert = clientCert;
        }
    } catch {}
}

/**
 * @param {Object} processor
 * @param {Object} requestConfig
 * @param {string[]} [extraNames]
 * @returns {void}
 */
export function warnUnresolvedVariables(processor, requestConfig, extraNames = []) {
    try {
        const unresolved = [...new Set([
            ...processor.extractUnresolvedVariableNames({
                url: requestConfig.url,
                headers: requestConfig.headers,
                queryParams: requestConfig.queryParams,
                pathParams: requestConfig.pathParams,
                body: requestConfig.body
            }),
            ...extraNames
        ])];

        if (unresolved.length === 0) {
            return;
        }

        const shown = unresolved.slice(0, 5).map(name => `{{${name}}}`).join(', ');
        const more = unresolved.length > 5 ? ` and ${unresolved.length - 5} more` : '';
        toast.warning(`Request sent with unresolved variables: ${shown}${more}`);
    } catch {}
}

/** @returns {Promise<{schema?: import('graphql').GraphQLSchema, url?: string, error?: string}>} */
export async function fetchGraphQLIntrospection() {
    const url = urlInput?.value?.trim() || urlInput?.getAttribute('value') || '';
    if (!url) {
        return { error: 'Enter a URL before fetching the schema' };
    }

    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const prepared = await resolveRequestPipeline({ url, headers, queryParams });
    if (!prepared.ok) {
        return { error: prepared.error };
    }
    const { url: resolvedUrl, authData } = prepared;

    const { timeout, verifySsl, followRedirects } = await resolveRequestSettings();

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

    attachAuthTransport(requestConfig, authData);
    attachClientCert(requestConfig);

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
 * @param {object} introspection
 * @returns {import('graphql').GraphQLSchema|null}
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

function globalResponseElements() {
    return {
        headersDisplay: responseHeadersDisplay,
        cookiesDisplay: responseCookiesDisplay,
        performanceDisplay: responsePerformanceDisplay
    };
}

function initResponseEditor() {
    if (!responseEditor && responseBodyContainer) {
        responseEditor = createLazyEditorProxy('response', responseBodyContainer);

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

/**
 * @param {string|null} tabId
 * @returns {HTMLElement|null}
 */
function statusContainerFor(tabId) {
    return responseContainerFor(tabId)?.statusContainer || document.querySelector('.status-info-container');
}

/** @param {string|null} tabId */
export function clearSchemaValidationBadge(tabId = null) {
    const statusContainer = statusContainerFor(tabId);
    if (!statusContainer) {
        return;
    }

    const existingBadge = statusContainer.querySelector('.response-validation-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
}

/**
 * @param {Object} validationResult
 * @param {string|null} tabId
 */
function displaySchemaValidationResult(validationResult, tabId = null) {
    clearSchemaValidationBadge(tabId);

    if (!validationResult.hasSchema) {
        return;
    }

    const statusContainer = statusContainerFor(tabId);
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

/** @param {string|null} tabId */
export function clearGraphQLErrorsBadge(tabId = null) {
    const statusContainer = statusContainerFor(tabId);
    const existingBadge = statusContainer?.querySelector('.graphql-errors-badge');
    if (existingBadge) {
        existingBadge.remove();
    }
}

/**
 * @param {Object} result
 * @param {string|null} tabId
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

    const statusContainer = statusContainerFor(tabId);
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
    const containerElements = responseContainerFor(tabId);

    if (containerElements && containerElements.editor) {
        containerElements.renderedResponse = null;
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

function clearResponseDisplay() {
    return clearResponseDisplayForTab(null);
}

export function clearResponseDisplayForTab(tabId = null) {
    const containerElements = responseContainerFor(tabId);

    if (containerElements && containerElements.editor) {
        containerElements.renderedResponse = null;
        containerElements.editor.clear();
    } else {
        initResponseEditor();
        if (responseEditor) {
            responseEditor.clear();
        }
    }
}

let requestInProgress = false;

/**
 * @param {boolean} inProgress
 * @returns {void}
 */
export function setRequestInProgress(inProgress) {
    requestInProgress = inProgress;
    if (inProgress) {
        sendRequestBtn.style.display = 'none';
        cancelRequestBtn.style.display = 'inline-block';
        setCancelButtonLabel(false);
        sendRequestBtn.disabled = true;
    } else {
        sendRequestBtn.style.display = 'inline-block';
        cancelRequestBtn.style.display = 'none';
        sendRequestBtn.disabled = false;
    }
    app.statusBar?.setRequestRunning(inProgress);
    if (!inProgress) {
        refreshStreamControls();
    }
}

/** @type {Object<string, function(string): boolean>} */
const LIVE_STREAM_CHECKS = Object.freeze({
    [RequestMode.WEBSOCKET]: isWebSocketLive,
    [RequestMode.SSE]: isSseLive,
    [RequestMode.GRPC]: isGrpcStreamLive
});

/**
 * @param {boolean} disconnect
 * @returns {void}
 */
function setCancelButtonLabel(disconnect) {
    if (!cancelRequestBtn) {
        return;
    }
    const label = disconnect ? translate('request.disconnect', 'Disconnect') : translate('request.cancel', 'Cancel');
    cancelRequestBtn.textContent = label;
    cancelRequestBtn.setAttribute('aria-label', label);
}

/**
 * @param {Object} processedPathParams
 * @param {string} queryString
 * @returns {Promise<{rewrite: {baseUrl: string, pathTemplate: string}, url: string}|null>}
 */
async function resolveMockRewrite(processedPathParams, queryString) {
    const { shouldUseMock, mockBaseUrl } = await getMockServerService().shouldUseMockServer(getCurrentEndpoint().collectionId);
    if (!shouldUseMock || !mockBaseUrl) {
        return null;
    }
    const collection = await getCollectionRepository().getById(getCurrentEndpoint().collectionId);
    if (!collection) {
        return null;
    }
    const endpoint = findRequest(collection, getCurrentEndpoint().endpointId);
    if (!endpoint?.path) {
        return null;
    }
    const mockPath = buildMockPath(endpoint.path, processedPathParams);
    return {
        rewrite: { baseUrl: mockBaseUrl, pathTemplate: endpoint.path },
        url: queryString ? `${mockBaseUrl}${mockPath}?${queryString}` : `${mockBaseUrl}${mockPath}`
    };
}

/** @returns {Promise<void>} */
async function refreshStreamControls() {
    if (requestInProgress || !cancelRequestBtn) {
        return;
    }
    const isLive = LIVE_STREAM_CHECKS[getCurrentMode()];
    const tabId = await getActiveTabId();
    if (requestInProgress) {
        return;
    }
    const live = Boolean(isLive?.(tabId));
    cancelRequestBtn.style.display = live ? 'inline-block' : 'none';
    setCancelButtonLabel(live);
}

if (typeof document !== 'undefined') {
    document.addEventListener(STREAM_STATE_EVENT, () => {
        refreshStreamControls();
    });
}

/** @type {Object<string, function(): Promise<*>>} */
const STREAMING_CANCELS = Object.freeze({
    [RequestMode.WEBSOCKET]: handleWebSocketCancel,
    [RequestMode.SSE]: handleSseCancel,
    [RequestMode.MQTT]: handleMqttCancel
});

export async function handleCancelRequest() {
    const cancelStreaming = STREAMING_CANCELS[getCurrentMode()];
    if (cancelStreaming) {
        await cancelStreaming();
        setRequestInProgress(false);
        return;
    }

    if (isGrpcMode()) {
        const tabId = await getActiveTabId();
        if (tabId && hasActiveGrpcStream(tabId)) {
            await cancelGrpcStream(tabId);
            setRequestInProgress(false);
            return;
        }
        const unaryId = inFlightRequestFor(tabId);
        if (unaryId) {
            await window.backendAPI.grpc.unaryCancel(unaryId).catch(() => { });
        }
        return;
    }

    try {
        const requestTabId = await getActiveTabId();

        const requestId = inFlightRequestFor(requestTabId);
        if (!requestId) {
            return;
        }
        const result = await window.backendAPI.cancelApiRequest(requestId);

        if (result.success) {
            await showStatusIfActive(requestTabId, 'Request cancelled');
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

/** @returns {string|null} */
function getActiveGraphQLOperationType() {
    if (!graphqlBodyManager) {
        return null;
    }
    const operations = graphqlBodyManager.graphqlEditor?.getOperations?.() || null;
    const selected = graphqlBodyManager.getSelectedOperationName?.() || null;
    return selectActiveOperationType(operations, selected);
}

async function handleGraphQLSubscriptionRequest() {
    const tabId = await getActiveTabId();

    if (tabId && isSubscriptionActive(tabId)) {
        await handleGraphQLSubscriptionCancel();
        return;
    }

    scheduleEndpointSave();

    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    let query = graphqlBodyManager.getGraphQLQuery().trim();
    const variablesText = graphqlBodyManager.getGraphQLVariables().trim();
    const operationName = graphqlBodyManager.getSelectedOperationName?.() || null;

    const prepared = await resolveRequestPipeline({
        url: urlInput?.value?.trim() || urlInput?.getAttribute('value') || '',
        headers,
        queryParams
    });
    if (!prepared.ok) {
        updateStatusDisplay(prepared.error, null);
        return;
    }
    const { url, variables, processor } = prepared;

    try {
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
        updateStatusDisplay(variableProcessingError(error), null);
    }
}

/**
 * @param {Object<string, string>} headers
 * @param {string} name
 * @param {string} value
 */
function setDefaultHeader(headers, name, value) {
    const existing = Object.keys(headers).find(
        (key) => key.toLowerCase() === name.toLowerCase()
    );
    if (!existing) {
        headers[name] = value;
    }
}

/**
 * @param {string} method
 * @param {Object<string, string>} headers
 * @param {Object} variables
 * @param {Object} processor
 * @returns {string|null}
 */
function buildSseBody(method, headers, variables, processor) {
    if (!methodCarriesBody(method)) {
        return null;
    }

    const bodyMode = document.getElementById('body-mode-select')?.value || 'json';

    if (bodyMode === 'text') {
        const raw = app.requestBodyTextEditor ? app.requestBodyTextEditor.getContent() : '';
        if (!raw.trim()) {
            return null;
        }
        setDefaultHeader(headers, 'Content-Type', 'text/plain');
        return processor.processTemplate(raw, variables);
    }

    const raw = getRequestBodyContent().trim();
    if (!raw) {
        return null;
    }

    const resolved = processor.processTemplate(raw, variables);
    try {
        JSON.parse(resolved);
    } catch (e) {
        throw new Error(`Invalid Body JSON: ${e.message}`, { cause: e });
    }
    setDefaultHeader(headers, 'Content-Type', 'application/json');
    return resolved;
}

/**
 * @param {Error} error
 * @returns {string}
 */
function variableProcessingError(error) {
    return `Variable processing error: ${error.message}`;
}

/** @returns {void} */
function scheduleEndpointSave() {
    const current = getCurrentEndpoint();
    if (current) {
        debouncedSaveRequestModifications(current.collectionId, current.endpointId);
    }
}

/**
 * @param {function(): Promise<*>} send
 * @returns {Promise<*>}
 */
async function withRequestInProgress(send) {
    setRequestInProgress(true);
    try {
        return await send();
    } finally {
        setRequestInProgress(false);
    }
}

/**
 * @param {string} protocolId
 * @returns {string}
 */
function readSendUrl(protocolId) {
    const mirrorId = getProtocol(protocolId).urlInputId;
    const mirror = mirrorId ? document.getElementById(mirrorId) : null;

    return mirror?.value?.trim()
        || urlInput?.value?.trim()
        || urlInput?.getAttribute('value')
        || '';
}

/**
 * @param {Array<{key: string, value: string, enabled: boolean}>} queryRows
 * @param {Object<string, string>} authQueryParams
 * @returns {void}
 */
function appendAuthQueryRows(queryRows, authQueryParams) {
    const rowKeys = new Set(queryRows.map((row) => row.key));
    for (const [key, value] of Object.entries(authQueryParams || {})) {
        if (!rowKeys.has(key)) {
            queryRows.push({ key, value, enabled: true });
        }
    }
}

/**
 * @param {{url: string, pathParams?: Object, headers: Object, queryParams: Object, queryRows?: Array<Object>, useAuth?: boolean, refreshOAuth?: boolean}} request
 * @returns {Promise<{ok: true, url: string, queryString: string, pathParams: Object, headers: Object, queryParams: Object, variables: Object, processor: Object, authData: Object|null}|{ok: false, error: string}>}
 */
async function resolveRequestPipeline({ url, pathParams = {}, headers, queryParams, queryRows, useAuth = true, refreshOAuth = true }) {
    const builder = getRequestBuilderService();

    try {
        const { variables, processor } = await builder.resolveVariables(getCurrentEndpoint(), headers);

        let authData = null;
        if (useAuth) {
            authData = await generateEffectiveAuthData({ variables, processor, refreshOAuth });
            builder.mergeAuthData(headers, queryParams, authData);
            if (queryRows) {
                appendAuthQueryRows(queryRows, authData.queryParams);
            }
        }

        const processed = builder.processRequestComponents({
            url, pathParams, headers, queryParams, queryRows, variables, processor
        });

        return { ok: true, ...processed, headers, queryParams, variables, processor, authData };
    } catch (error) {
        return { ok: false, error: variableProcessingError(error) };
    }
}

/**
 * @param {string} protocolId
 * @param {boolean} useAuth
 * @returns {Promise<Object>}
 */
function prepareStreamingSend(protocolId, useAuth) {
    return resolveRequestPipeline({
        url: readSendUrl(protocolId),
        headers: useAuth ? parseKeyValuePairs(document.getElementById('headers-list')) : {},
        queryParams: useAuth ? parseKeyValuePairs(document.getElementById('query-params-list')) : {},
        useAuth
    });
}

/** @returns {Object} */
function readMqttOptions() {
    const fieldValue = (id) => document.getElementById(id)?.value?.trim() || '';

    return {
        clientId: fieldValue('mqtt-client-id-input'),
        username: document.getElementById('mqtt-username-input')?.value || '',
        password: document.getElementById('mqtt-password-input')?.value || '',
        subscribeTopic: fieldValue('mqtt-subscribe-input'),
        publishTopic: fieldValue('mqtt-topic-input'),
        qos: Number(document.getElementById('mqtt-qos-select')?.value) || 0,
        payload: getRequestBodyContent() || ''
    };
}

/** @type {Object<string, {useAuth: boolean, send: function(Object): Promise<*>}>} */
const STREAMING_SENDS = Object.freeze({
    [RequestMode.WEBSOCKET]: Object.freeze({
        useAuth: true,
        buildPayload: ({ variables, processor }) => {
            const message = processor.processTemplate(getRequestBodyContent() || '', variables);
            warnUnresolvedVariables(processor, { body: message });
            return message;
        },
        send: ({ url, headers }, message) => handleWebSocketSend(url, headers, message)
    }),
    [RequestMode.SSE]: Object.freeze({
        useAuth: true,
        buildPayload: ({ headers, variables, processor }) => {
            const method = methodSelect?.value || 'GET';
            return { method, body: buildSseBody(method, headers, variables, processor) };
        },
        send: ({ url, headers }, payload) => handleSseConnect(url, headers, payload)
    }),
    [RequestMode.MQTT]: Object.freeze({
        useAuth: false,
        buildPayload: ({ variables, processor }) => {
            const options = processor.processObject(readMqttOptions(), variables);
            warnUnresolvedVariables(processor, { body: options });
            return options;
        },
        send: ({ url }, options) => handleMqttSend(url, options)
    })
});

/**
 * @param {string} protocolId
 * @param {{useAuth: boolean, buildPayload?: function(Object): *, send: function(Object, *): Promise<*>}} config
 * @returns {Promise<void>}
 */
async function runStreamingSend(protocolId, { useAuth, buildPayload, send }) {
    scheduleEndpointSave();

    const prepared = await prepareStreamingSend(protocolId, useAuth);
    if (!prepared.ok) {
        updateStatusDisplay(prepared.error, null);
        return;
    }

    let payload = null;
    if (buildPayload) {
        try {
            payload = buildPayload(prepared);
        } catch (error) {
            toast.error(error.message);
            updateStatusDisplay(error.message, null);
            return;
        }
    }

    await withRequestInProgress(() => send(prepared, payload));
}

/**
 * @param {Object} requestConfig
 * @param {Object} outcome
 * @param {Object} scriptResult
 * @param {Object} historySensitive
 * @returns {Promise<void>}
 */
async function recordRequestOutcome(requestConfig, outcome, scriptResult, historySensitive) {
    const endpoint = getCurrentEndpoint();

    if (app.historyController) {
        const activeEnvName = await app.environmentController?.service?.getActiveEnvironment()
            .then(e => e?.name || null)
            .catch(() => null) || null;
        app.historyController
            .addHistoryEntry(requestConfig, outcome, endpoint, activeEnvName, historySensitive)
            .catch(() => { });
    }

    if (endpoint && app.scriptController) {
        try {
            await app.scriptController.executeTest(
                endpoint.collectionId,
                endpoint.endpointId,
                requestConfig,
                scriptResult
            );
        } catch {}
    }
}

/**
 * @param {Object} processor
 * @param {Object} variables
 * @returns {{body?: {query: string, variables: Object, operationName?: string}, error?: string}}
 */
function buildGraphQLPayload(processor, variables) {
    const query = processor.processTemplate(graphqlBodyManager.getGraphQLQuery().trim(), variables);
    const variablesText = processor.processTemplate(graphqlBodyManager.getGraphQLVariables().trim(), variables);

    let parsedVariables = {};
    if (variablesText) {
        try {
            parsedVariables = JSON.parse(variablesText);
        } catch (e) {
            return { error: `Invalid GraphQL Variables JSON: ${e.message}` };
        }
    }

    const body = { query, variables: parsedVariables };
    const operationName = graphqlBodyManager.getSelectedOperationName?.();
    if (operationName) {
        body.operationName = operationName;
    }
    return { body };
}

/**
 * @param {string} bodyMode
 * @param {Object} processor
 * @param {Object} variables
 * @returns {{body?: *, error?: string}}
 */
function buildSendBody(bodyMode, processor, variables) {
    try {
        if (isGraphQLMode() && graphqlBodyManager) {
            return buildGraphQLPayload(processor, variables);
        }

        const captured = captureSnippetBody({
            bodyMode,
            formBodyManager: app.formBodyManager,
            requestBodyTextEditor: app.requestBodyTextEditor,
            jsonContent: getRequestBodyContent(),
            processor,
            variables
        });
        if (captured.error) {
            return { error: `Invalid Body JSON: ${captured.error}` };
        }
        if (bodyMode === 'binary' && app.formBodyManager && captured.body === undefined) {
            return { error: 'No file selected for binary body.' };
        }
        return { body: captured.body };
    } catch (e) {
        return { error: `Error processing request body: ${e.message}` };
    }
}

/**
 * @param {string} message
 * @returns {void}
 */
function abortSend(message) {
    toast.error(message);
    clearResponseDisplay();
    setRequestInProgress(false);
}

/** @returns {Promise<Object>} */
async function prepareHttpSend() {
    let url = urlInput?.value?.trim() || '';
    if (!url && urlInput) {
        url = urlInput.getAttribute('value') || '';
    }

    const method = isGraphQLMode() ? 'POST' : methodSelect.value;
    const pathParams = parseKeyValuePairs(document.getElementById('path-params-list'));
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));
    const queryRows = parseKeyValueRows(document.getElementById('query-params-list'))
        .filter((row) => row.enabled);

    const prepared = await resolveRequestPipeline({ url, pathParams, headers, queryParams, queryRows });
    if (!prepared.ok) {
        return prepared;
    }

    return {
        ...prepared,
        rawUrl: url,
        method,
        historySensitive: {
            headerNames: Object.keys(prepared.authData.headers || {}),
            queryNames: Object.keys(prepared.authData.queryParams || {})
        }
    };
}

/**
 * @param {Object} processedPathParams
 * @param {string} queryString
 * @returns {Promise<{rewrite: {baseUrl: string, pathTemplate: string}, url: string}|null>}
 */
async function tryResolveMockRewrite(processedPathParams, queryString) {
    if (!getCurrentEndpoint()) {
        return null;
    }
    try {
        return await resolveMockRewrite(processedPathParams, queryString);
    } catch (error) {
        console.warn('Mock server check failed, sending to the real URL:', error);
        return null;
    }
}

/**
 * @param {{method: string, url: string, rawUrl: string, headers: Object, queryParams: Object, pathParams: Object, body: *, bodyMode: string}} parts
 * @returns {Promise<Object>}
 */
async function buildSendConfig({ method, url, rawUrl, headers, queryParams, pathParams, body, bodyMode }) {
    const { httpVersion, timeout, verifySsl, followRedirects } = await resolveRequestSettings();

    return {
        method,
        url,
        rawUrl,
        headers,
        queryParams,
        pathParams,
        body,
        bodyType: (bodyMode === 'formdata' || bodyMode === 'urlencoded' || bodyMode === 'text' || bodyMode === 'binary') ? bodyMode : undefined,
        httpVersion,
        timeout,
        verifySsl,
        followRedirects
    };
}

/**
 * @param {Object} requestConfig
 * @param {string|null} requestTabId
 * @returns {Promise<{requestConfig: Object, snapshot: {url: string, queryParams: Object, pathParams: Object}}|null>}
 */
async function runPreRequestScript(requestConfig, requestTabId) {
    const snapshot = {
        url: requestConfig.url,
        queryParams: { ...requestConfig.queryParams },
        pathParams: { ...requestConfig.pathParams }
    };
    try {
        const scripted = await app.scriptController.executePreRequest(
            getCurrentEndpoint().collectionId,
            getCurrentEndpoint().endpointId,
            requestConfig
        );
        return { requestConfig: scripted, snapshot };
    } catch (error) {
        const message = `Pre-request script error: ${error.message}`;
        displayResponseWithLineNumbersForTab(`${message}\n\nThe request was not sent.`, null, requestTabId);
        clearResponsePanes(requestTabId, globalResponseElements());
        await showStatusIfActive(requestTabId, message);
        toast.error(message);
        return null;
    }
}

/**
 * @param {Object} requestConfig
 * @param {{snapshot: Object, rawUrl: string, variables: Object, processor: Object, mockRewrite: Object|null, authData: Object}} ctx
 * @returns {void}
 */
function applyScriptMutations(requestConfig, { snapshot, rawUrl, variables, processor, mockRewrite, authData }) {
    const builder = getRequestBuilderService();
    requestConfig.url = builder.applyScriptParamMutations({
        requestConfig, snapshot, rawUrl, variables, processor, mockRewrite
    });
    const authStripped = builder.stripCrossOriginAuth({
        requestConfig,
        originalUrl: snapshot.url,
        authData
    });
    if (authStripped) {
        toast.warning('Authentication was not sent: the pre-request script changed the request host.');
    }
}

/**
 * @param {Object} requestConfig
 * @returns {Promise<void>}
 */
async function attachCookieHeader(requestConfig) {
    if (!app.cookieController) {
        return;
    }
    const cookieHeader = await app.cookieController.getCookieHeader(requestConfig.url);
    if (!cookieHeader) {
        return;
    }
    requestConfig.headers = requestConfig.headers || {};
    if (!requestConfig.headers['Cookie'] && !requestConfig.headers['cookie']) {
        requestConfig.headers['Cookie'] = cookieHeader;
    }
}

/**
 * @param {Object} requestConfig
 * @param {{processor: Object, authData: Object}} ctx
 * @returns {Promise<void>}
 */
async function decorateSendConfig(requestConfig, { processor, authData }) {
    attachClientCert(requestConfig);
    await attachCookieHeader(requestConfig);
    warnUnresolvedVariables(processor, requestConfig, authData.unresolvedVariables || []);
}

/**
 * @param {Object} error
 * @param {string} errorMessage
 * @returns {string}
 */
function errorResponseText(error, errorMessage) {
    if (!error.data) {
        return `Error: ${errorMessage}`;
    }
    try {
        return typeof error.data === 'object' ? JSON.stringify(error.data, null, 2) : String(error.data);
    } catch {
        return `Error: ${errorMessage}`;
    }
}

/**
 * @param {Object} error
 * @param {{requestConfig: Object, requestTabId: string|null, historySensitive: Object}} ctx
 * @returns {Promise<void>}
 */
async function handleSendError(error, { requestConfig, requestTabId, historySensitive }) {
    const status = error.status || null;
    const statusText = error.statusText || '';
    const errorMessage = error.message || 'Unknown error';
    const contentType = error.headers?.['content-type'] || null;

    displayResponseWithLineNumbersForTab(errorResponseText(error, errorMessage), contentType, requestTabId);
    displayErrorResponsePanes(requestTabId, globalResponseElements(), error);
    clearGraphQLErrorsBadge(requestTabId);

    if (await isTabCurrentlyActive(requestTabId)) {
        updateStatusDisplay(status ? `${status}${statusText ? ` ${statusText}` : ''}` : 'Request Failed', status);
        updateResponseTime(error.ttfb);
        updateResponseSize(error.size);
    }

    await recordRequestOutcome(requestConfig, error, error, historySensitive);
}

export async function handleSendRequest() {
    if (isGrpcMode()) {
        return handleGrpcSend();
    }

    if (isGraphQLMode()) {
        const gqlTabId = await getActiveTabId();
        if ((gqlTabId && isSubscriptionActive(gqlTabId))
            || getActiveGraphQLOperationType() === 'subscription') {
            return handleGraphQLSubscriptionRequest();
        }
    }

    const streaming = STREAMING_SENDS[getCurrentMode()];
    if (streaming) {
        return runStreamingSend(getCurrentMode(), streaming);
    }

    setRequestInProgress(true);

    scheduleEndpointSave();

    const prepared = await prepareHttpSend();
    if (!prepared.ok) {
        updateStatusDisplay(prepared.error, null);
        setRequestInProgress(false);
        return;
    }
    const { method, rawUrl, headers, queryParams, variables, processor, authData, historySensitive } = prepared;

    const mock = await tryResolveMockRewrite(prepared.pathParams, prepared.queryString);
    const mockRewrite = mock ? mock.rewrite : null;
    const url = mock ? mock.url : prepared.url;

    const bodyMode = document.getElementById('body-mode-select')?.value || 'json';
    let body = undefined;
    if (requestSendsBody(method, bodyMode)) {
        const built = buildSendBody(bodyMode, processor, variables);
        if (built.error) {
            abortSend(built.error);
            return;
        }
        ({ body } = built);
    }

    let requestConfig = await buildSendConfig({
        method, url, rawUrl, headers, queryParams, pathParams: prepared.pathParams, body, bodyMode
    });

    const requestTabId = await getActiveTabId();
    let untrackRequest = null;

    try {
        await new Promise(resolve => requestAnimationFrame(resolve));

        displayResponseWithLineNumbersForTab('Sending request...', null, requestTabId);

        clearResponsePanes(requestTabId, globalResponseElements());

        attachAuthTransport(requestConfig, authData);

        if (getCurrentEndpoint() && app.scriptController) {
            const scripted = await runPreRequestScript(requestConfig, requestTabId);
            if (!scripted) {
                return;
            }
            ({ requestConfig } = scripted);
            applyScriptMutations(requestConfig, {
                snapshot: scripted.snapshot, rawUrl, variables, processor, mockRewrite, authData
            });
        }

        await decorateSendConfig(requestConfig, { processor, authData });

        requestConfig.requestId = newRequestId();
        untrackRequest = trackInFlight(requestTabId, requestConfig.requestId);
        const response = await window.backendAPI.sendApiRequest(requestConfig);

        if (response.cancelled) {
            await showStatusIfActive(requestTabId, 'Request cancelled');
            displayResponseWithLineNumbersForTab('Request was cancelled', null, requestTabId);
            clearResponsePanes(requestTabId, globalResponseElements());
            clearGraphQLErrorsBadge(requestTabId);
            setRequestInProgress(false);
        } else if (response.status) {
            await handleReceivedResponse(response, { requestConfig, requestTabId, url, historySensitive });
        } else {
            throw response;
        }
    } catch (error) {
        await handleSendError(error, { requestConfig, requestTabId, historySensitive });
    } finally {
        untrackRequest?.();
        setRequestInProgress(false);
    }
}

/**
 * @param {Object} result
 * @param {Object} ctx
 * @param {Object} ctx.requestConfig
 * @param {string|null} ctx.requestTabId
 * @param {string} ctx.url
 * @param {boolean} ctx.historySensitive
 * @returns {Promise<void>}
 */
async function handleReceivedResponse(result, { requestConfig, requestTabId, url, historySensitive }) {
    const contentType = result.headers?.['content-type'] ?? null;
    const isSuccess = result.status >= 200 && result.status < 300;

    let formattedResponse;
    let languageHint;
    if (result.isBinary) {
        const byteCount = result.size || 0;
        formattedResponse = `[Binary response — ${byteCount} byte${byteCount === 1 ? '' : 's'}]\n\n`
            + `Content-Type: ${contentType || 'application/octet-stream'}\n\n`
            + 'This response is not text. Use the Save button in the response toolbar to write it to a file.';
        languageHint = 'text';
    } else if (typeof result.data === 'string') {
        formattedResponse = result.data;
    } else if (result.data === undefined) {
        formattedResponse = '';
    } else {
        formattedResponse = JSON.stringify(result.data, null, 2);
        languageHint = 'json';
    }

    setResponseMeta(requestTabId, {
        isBinary: Boolean(result.isBinary),
        base64: result.bodyBase64 || null,
        suggestedName: suggestedFileName(url, contentType)
    });

    displayResponseWithLineNumbersForTab(formattedResponse, contentType, requestTabId, languageHint);

    if (app.schemaController && !result.isBinary) {
        app.schemaController.setLastResponseBody(result.data);
        if (isGraphQLMode() || !isSuccess) {
            clearSchemaValidationBadge(requestTabId);
        } else {
            const validationResult = app.schemaController.validateResponse(result.data);
            displaySchemaValidationResult(validationResult, requestTabId);
        }
    }

    displayGraphQLErrorsBadge(result, requestTabId);

    displayResponsePanes(requestTabId, globalResponseElements(), {
        headers: result.headers,
        timings: result.timings,
        size: result.size,
        setCookies: result.setCookies
    });

    if (app.cookieController && result.setCookies && result.setCookies.length > 0) {
        app.cookieController.handleCookiesFromResponse(result.setCookies, requestConfig.url);
    }

    if (await isTabCurrentlyActive(requestTabId)) {
        updateStatusDisplay(`Status: ${result.status} ${result.statusText || ''}`.trim(), result.status);
        updateResponseTime(result.ttfb);
        updateResponseSize(result.size);
    }
    setRequestInProgress(false);

    const cookies = responseCookies(result);

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
                cookies
            },
            isModified: false
        }).catch(() => { });
        if (app.workspaceTabController.tabBar?.updateTab) {
            app.workspaceTabController.tabBar.updateTab(requestTabId, { isModified: false });
        }
    }

    await recordRequestOutcome(requestConfig, result, { ...result, cookies }, historySensitive);
}

export async function handleGenerateCurl() {
    scheduleEndpointSave();

    const method = methodSelect.value;
    let body = undefined;

    const pathParams = parseKeyValuePairs(document.getElementById('path-params-list'));
    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const prepared = await resolveRequestPipeline({
        url: urlInput.value.trim(), pathParams, headers, queryParams, refreshOAuth: false
    });
    if (!prepared.ok) {
        updateStatusDisplay(prepared.error, null);
        return;
    }
    const { url, variables: resolvedVariables, processor } = prepared;

    const bodyModeSelect = document.getElementById('body-mode-select');
    const bodyMode = bodyModeSelect?.value || 'json';
    let bodyType;

    if (requestSendsBody(method, bodyMode)) {
        const captured = captureSnippetBody({
            bodyMode,
            formBodyManager: app.formBodyManager,
            requestBodyTextEditor: app.requestBodyTextEditor,
            jsonContent: getRequestBodyContent(),
            processor,
            variables: resolvedVariables
        });
        if (captured.error) {
            updateStatusDisplay(`Invalid Body JSON: ${captured.error}`, null);
            return;
        }
        ({ body, bodyType } = captured);
    }

    const requestConfig = {
        method,
        url,
        headers,
        body,
        bodyType
    };

    const codeSnippetDialog = new CodeSnippetDialog();
    codeSnippetDialog.show(requestConfig);
}
