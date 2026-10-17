import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { responseInspectionSource } from './responseInspectionSource.js';
import { urlInput, methodSelect } from './domElements.js';
import { toast } from './ui/Toast.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs, parseKeyValueRows } from './keyValueManager.js';
import { methodCarriesBody, requestSendsBody } from './utils/bodyMethods.js';
import { inFlightRequestFor, newRequestId, trackInFlight } from './state/inFlightRequests.js';
import { resolveRequestSettings } from './state/settingsCache.js';
import {
    getRequestPipeline,
    warnUnresolvedVariables,
    variableProcessingError,
    resolveRequestPipeline
} from './requestServices.js';
import { scheduleEndpointSave } from './endpointSave.js';
import { buildGraphQLBody } from './utils/graphqlBody.js';
import { setRequestInProgress, withRequestInProgress } from './sendControls.js';

import { CodeSnippetDialog } from './ui/CodeSnippetDialog.js';
import {
    globalResponseElements,
    displaySchemaValidationResult,
    renderGraphQLErrorsBadge,
    displayResponseWithLineNumbersForTab,
    clearResponseDisplayForTab,
    clearSchemaValidationBadge,
    clearGraphQLErrorsBadge
} from './responseView.js';
import { responseCookies } from './cookieParser.js';
import { getRequestBodyContent, captureSnippetBody } from './requestBodyHelper.js';
import { isGraphQLMode, getCurrentMode, RequestMode } from './requestModeManager.js';
import { getProtocol, getProtocolHandler, registerProtocolHandler } from './protocols/protocolRegistry.js';
import { handleGrpcSend, handleGrpcCancel } from './grpcHandler.js';
import { handleWebSocketCancel, handleWebSocketSend, isWebSocketLive } from './websocketHandler.js';
import { handleSseCancel, handleSseConnect, isSseLive } from './sseHandler.js';
import { handleMqttCancel, handleMqttSend } from './mqttHandler.js';
import { readMqttForm } from './mqtt/mqttFields.js';
import {
    handleGraphQLSubscriptionStart,
    handleGraphQLSubscriptionCancel,
    isSubscriptionActive
} from './graphqlSubscriptionHandler.js';
import { selectActiveOperationType } from './graphqlTransportWs.js';
import { isGrpcStreamLive } from './grpcStreamHandler.js';
import { getActiveTabId, isTabCurrentlyActive, showStatusIfActive } from './streaming/streamSession.js';
import { clearResponsePanes, displayResponsePanes, displayErrorResponsePanes } from './ResponseDisplayHelper.js';
import { setResponseMeta, suggestedFileName } from './responseSaver.js';

let graphqlBodyManager = null;

export function setGraphQLBodyManager(manager) {
    graphqlBodyManager = manager;
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

    renderGraphQLErrorsBadge(errors, tabId);
}

function clearResponseDisplay() {
    return clearResponseDisplayForTab(null);
}

/**
 * @param {function(): Promise<*>} cancel
 * @returns {Promise<void>}
 */
async function cancelStreaming(cancel) {
    await cancel();
    setRequestInProgress(false);
}

/** @returns {Promise<void>} */
async function cancelHttpRequest() {
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

/** @returns {Promise<*>} */
export async function handleCancelRequest() {
    return getProtocolHandler(getCurrentMode()).cancel();
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
    return {
        ...readMqttForm({ trim: true }),
        payload: getRequestBodyContent() || ''
    };
}

/** @type {Object<string, {useAuth: boolean, send: function(Object): Promise<*>}>} */
/**
 * @typedef {Object} StreamingSend
 * @property {boolean} useAuth
 * @property {(prepared: Object) => *} [buildPayload]
 * @property {(prepared: Object, payload: *) => Promise<*>} send
 */

/** @type {StreamingSend} */
const WEBSOCKET_STREAM = Object.freeze({
    useAuth: true,
    buildPayload: ({ variables, processor }) => {
        const message = processor.processTemplate(getRequestBodyContent() || '', variables);
        warnUnresolvedVariables(processor, { body: message });
        return message;
    },
    send: ({ url, headers }, message) => handleWebSocketSend(url, headers, message)
});

/** @type {StreamingSend} */
const SSE_STREAM = Object.freeze({
    useAuth: true,
    buildPayload: ({ headers, variables, processor }) => {
        const method = methodSelect?.value || 'GET';
        return { method, body: buildSseBody(method, headers, variables, processor) };
    },
    send: ({ url, headers }, payload) => handleSseConnect(url, headers, payload)
});

/** @type {StreamingSend} */
const MQTT_STREAM = Object.freeze({
    useAuth: false,
    buildPayload: ({ variables, processor }) => {
        const options = processor.processObject(readMqttOptions(), variables);
        warnUnresolvedVariables(processor, { body: options });
        return options;
    },
    send: ({ url }, options) => handleMqttSend(url, options)
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
    const built = buildGraphQLBody({
        query: graphqlBodyManager.getGraphQLQuery(),
        variables: graphqlBodyManager.getGraphQLVariables(),
        operationName: graphqlBodyManager.getSelectedOperationName?.()
    }, (text) => processor.processTemplate(text, variables));
    if (built.error) {
        return { error: `Invalid GraphQL Variables JSON: ${built.error.message}` };
    }
    return { body: built.body };
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
        protocol: isGraphQLMode() ? RequestMode.GRAPHQL : RequestMode.HTTP,
        historySensitive: {
            headerNames: Object.keys(prepared.authData.headers || {}),
            queryNames: Object.keys(prepared.authData.queryParams || {})
        }
    };
}

/**
 * @param {{protocol: string, method: string, url: string, rawUrl: string, headers: Object, queryParams: Object, pathParams: Object, body: *, bodyMode: string, authData: Object}} parts
 * @returns {Promise<Object>}
 */
async function buildSendConfig({ protocol, method, url, rawUrl, headers, queryParams, pathParams, body, bodyMode, authData }) {
    const settings = await resolveRequestSettings();
    return getRequestPipeline().assembleRequestConfig({
        protocol, method, url, rawUrl, headers, queryParams, pathParams, body, bodyType: bodyMode, settings, authData
    });
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
function applyScriptMutations(requestConfig, ctx) {
    if (getRequestPipeline().applyScriptMutations(requestConfig, ctx)) {
        toast.warning('Authentication was not sent: the pre-request script changed the request host.');
    }
}

/**
 * @param {Object} requestConfig
 * @param {{processor: Object, authData: Object}} ctx
 * @returns {Promise<void>}
 */
async function decorateSendConfig(requestConfig, { processor, authData }) {
    await getRequestPipeline().finalize(requestConfig);
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

/** @returns {Promise<*>} */
async function sendGraphQLRequest() {
    const gqlTabId = await getActiveTabId();
    if ((gqlTabId && isSubscriptionActive(gqlTabId))
        || getActiveGraphQLOperationType() === 'subscription') {
        return handleGraphQLSubscriptionRequest();
    }
    return sendHttpRequest();
}

/** @returns {Promise<*>} */
export async function handleSendRequest() {
    return getProtocolHandler(getCurrentMode()).send();
}

/** @returns {Promise<void>} */
async function sendHttpRequest() {
    setRequestInProgress(true);

    const { schemaController } = app;
    await schemaController?.editor?.__ready;
    const schemaSnapshot = schemaController?.captureSchema();

    scheduleEndpointSave();

    const prepared = await prepareHttpSend();
    if (!prepared.ok) {
        updateStatusDisplay(prepared.error, null);
        setRequestInProgress(false);
        return;
    }
    const { protocol, method, rawUrl, headers, queryParams, variables, processor, authData, historySensitive } = prepared;

    const { url, mockRewrite } = await getRequestPipeline().resolveMockRewrite({
        endpoint: getCurrentEndpoint(),
        url: prepared.url,
        queryString: prepared.queryString,
        pathParams: prepared.pathParams
    });

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
        protocol, method, url, rawUrl, headers, queryParams, pathParams: prepared.pathParams, body, bodyMode, authData
    });

    const requestTabId = await getActiveTabId();
    let untrackRequest = null;

    try {
        await new Promise(resolve => requestAnimationFrame(resolve));

        displayResponseWithLineNumbersForTab('Sending request...', null, requestTabId);

        clearResponsePanes(requestTabId, globalResponseElements());

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
            await handleReceivedResponse(response, { requestConfig, requestTabId, url, historySensitive, schemaController, schemaSnapshot });
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
async function handleReceivedResponse(result, { requestConfig, requestTabId, url, historySensitive, schemaController, schemaSnapshot }) {
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
    const responseManager = app.responseContainerManager;
    const responseContainer = responseManager?.containers?.get(requestTabId);
    responseContainer?.inspection?.setSource(responseInspectionSource(result));
    const inspectionSource = responseContainer?.inspection?.source;
    const isCurrentResponse = () => inFlightRequestFor(requestTabId) === requestConfig.requestId &&
        app.responseContainerManager === responseManager &&
        (!responseManager?.containers || (responseContainer &&
            responseManager.containers.get(requestTabId) === responseContainer));



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
                isJson: result.isJson,
                isBinary: Boolean(result.isBinary),
                bodyBase64: result.bodyBase64 || null,
                truncated: Boolean(result.truncated),
                headers: result.headers || {},
                status: result.status,
                statusText: result.statusText,
                ttfb: result.ttfb,
                size: result.size,
                timings: result.timings,
                cookies
            },
            isModified: false
        }).then(updated => {
            if (responseContainer && app.responseContainerManager === responseManager &&
                responseManager.containers.get(requestTabId) === responseContainer &&
                responseContainer.inspection?.source === inspectionSource) {
                responseContainer.renderedResponse = updated?.response || null;
            }
        }).catch(() => { });
        if (app.workspaceTabController.tabBar?.updateTab) {
            app.workspaceTabController.tabBar.updateTab(requestTabId, { isModified: false });
        }
    }

    await recordRequestOutcome(requestConfig, result, { ...result, cookies }, historySensitive);

    // Finish response bookkeeping before waiting: another send may complete meanwhile.
    if (schemaController && !result.isBinary && isCurrentResponse()) {
        if (schemaController.isCurrentSnapshot(schemaSnapshot)) {
            schemaController.setLastResponseBody(result.data);
        }
        if (requestConfig.protocol === 'graphql' || !isSuccess) {
            if (schemaController.isCurrentSnapshot(schemaSnapshot)) {
                clearSchemaValidationBadge(requestTabId);
            }
        } else {
            const validationResult = await schemaController.validateResponse(result.data, schemaSnapshot, { isJson: result.isJson !== false });
            if (isCurrentResponse() && schemaController.isCurrentSnapshot(schemaSnapshot)) {
                displaySchemaValidationResult(validationResult, requestTabId);
            }
        }
    }
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

registerProtocolHandler(RequestMode.HTTP, {
    send: sendHttpRequest,
    cancel: cancelHttpRequest,
    isLive: () => false
});
registerProtocolHandler(RequestMode.WEBSOCKET, {
    send: () => runStreamingSend(RequestMode.WEBSOCKET, WEBSOCKET_STREAM),
    cancel: () => cancelStreaming(handleWebSocketCancel),
    isLive: isWebSocketLive
});
registerProtocolHandler(RequestMode.SSE, {
    send: () => runStreamingSend(RequestMode.SSE, SSE_STREAM),
    cancel: () => cancelStreaming(handleSseCancel),
    isLive: isSseLive
});
registerProtocolHandler(RequestMode.MQTT, {
    send: () => runStreamingSend(RequestMode.MQTT, MQTT_STREAM),
    cancel: () => cancelStreaming(handleMqttCancel),
    isLive: () => false
});
registerProtocolHandler(RequestMode.GRPC, {
    send: handleGrpcSend,
    cancel: handleGrpcCancel,
    isLive: isGrpcStreamLive
});
registerProtocolHandler(RequestMode.GRAPHQL, {
    send: sendGraphQLRequest,
    cancel: cancelHttpRequest,
    isLive: isSubscriptionActive
});
