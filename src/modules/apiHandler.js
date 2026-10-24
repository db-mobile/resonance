import { CoreExecutionService, executionError } from './services/CoreExecutionService.js';
import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { responseInspectionSource } from './responseInspectionSource.js';
import { clone } from './utils/clone.js';
import { captureManualBody } from './services/manualRequestTemplates.js';
import { translate } from './utils/translate.js';
import { urlInput, methodSelect } from './domElements.js';
import { toast } from './ui/Toast.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import { parseKeyValuePairs, parseKeyValueRows } from './keyValueManager.js';
import { methodCarriesBody, requestSendsBody } from './utils/bodyMethods.js';
import { inFlightRequestFor, trackInFlight } from './state/inFlightRequests.js';
import {
    getRequestPipeline,
    warnUnresolvedVariables,
    variableProcessingError,
    resolveRequestPipeline
} from './requestServices.js';
import { scheduleEndpointSave } from './endpointSave.js';
import { setRequestInProgress, withRequestInProgress } from './sendControls.js';

import { CodeSnippetDialog } from './ui/CodeSnippetDialog.js';
import {
    globalResponseElements,
    displaySchemaValidationResult,
    renderGraphQLErrorsBadge,
    displayResponseWithLineNumbersForTab,
    clearSchemaValidationBadge,
    clearGraphQLErrorsBadge
} from './responseView.js';
import { responseCookies } from './cookieParser.js';
import { getRequestBodyContent, captureSnippetBody } from './requestBodyHelper.js';
import { isGraphQLMode, getCurrentMode, RequestMode } from './requestModeManager.js';
import { getProtocol, getProtocolHandler, registerProtocolHandler } from './protocols/protocolRegistry.js';
import { handleGrpcSend, handleGrpcCancel } from './grpcHandler.js';
import { handleWebSocketConnect, handleWebSocketCancel, handleWebSocketSend, isWebSocketLive, getWebSocketState, isWebSocketSending, getWebSocketBodyContent } from './websocketHandler.js';
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


/**
 * @param {function(): Promise<*>} cancel
 * @returns {Promise<void>}
 */
async function cancelStreaming(cancel) {
    await cancel();
    setRequestInProgress(false);
}

/** @returns {Promise<void>} */
const manualExecutions = new Map();

async function cancelHttpRequest() {
    let requestTabId;
    try {
        requestTabId = await getActiveTabId();

        const execution = manualExecutions.get(requestTabId);
        if (!execution) { return; }
        await execution.cancel();
        const result = { success: true };

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
        if (await isTabCurrentlyActive(requestTabId)) { setRequestInProgress(false); }
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

/** Toggle only the connection; the composer is deliberately excluded. */
export async function handleWebSocketConnectionAction() {
    const tab = getActiveTabId();
    const request = {
        url: readSendUrl(RequestMode.WEBSOCKET),
        headers: parseKeyValuePairs(document.getElementById('headers-list')),
        queryParams: parseKeyValuePairs(document.getElementById('query-params-list')),
        endpoint: getCurrentEndpoint() ? { ...getCurrentEndpoint() } : null,
        authConfig: clone(app.authManager?.getAuthConfig?.())
    };
    const tabId = await tab;
    if (getWebSocketState(tabId) !== 'closed') { return handleWebSocketCancel(tabId); }
    scheduleEndpointSave();
    return handleWebSocketConnect({
        tabId, url: request.url,
        prepare: async () => {
            const prepared = await resolveRequestPipeline({ ...request, useAuth: true });
            if (!prepared.ok) { throw new Error(prepared.error); }
            return prepared;
        }
    });
}

async function sendWebSocketMessage() {
    const tab = getActiveTabId();
    const message = getWebSocketBodyContent() || '';
    const endpoint = getCurrentEndpoint() ? { ...getCurrentEndpoint() } : null;
    const tabId = await tab;
    scheduleEndpointSave();
    return handleWebSocketSend(message, tabId, async (body) => {
        const { variables, processor } = await getRequestPipeline().requestBuilder.resolveVariables(endpoint, {});
        const processed = processor.processTemplate(body, variables);
        warnUnresolvedVariables(processor, { body: processed });
        return processed;
    });
}

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
async function recordRequestOutcome(requestConfig, outcome, _scriptResult, historySensitive, scriptContext) {
    if (app.historyController) {
        await app.historyController.addHistoryEntry(requestConfig, outcome, scriptContext.endpoint,
            scriptContext.environmentName, historySensitive);
    }
}

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
async function handleSendError(error, { requestConfig, requestTabId, historySensitive, scriptContext }) {
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

    await recordRequestOutcome(requestConfig, error, error, historySensitive, scriptContext);
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
    const endpoint = getCurrentEndpoint() ? { ...getCurrentEndpoint() } : null;
    const controller = app.scriptController;
    const captured = {
        endpoint, authConfig: clone(app.authManager?.getAuthConfig?.()),
        scripts: (!endpoint || controller?.isShowingScriptsFor(endpoint.collectionId, endpoint.endpointId))
            ? clone(controller?.scriptManager?.getCurrentScripts?.()) : null,
        inputs: { url: urlInput?.value?.trim() || urlInput?.getAttribute('value') || '', method: isGraphQLMode() ? 'POST' : methodSelect.value,
            protocol: isGraphQLMode() ? RequestMode.GRAPHQL : RequestMode.HTTP,
            pathParams: parseKeyValuePairs(document.getElementById('path-params-list')),
            headers: parseKeyValuePairs(document.getElementById('headers-list')),
            queryRows: parseKeyValueRows(document.getElementById('query-params-list')).filter(row => row.enabled) },
        bodySource: captureManualBody(document.getElementById('body-mode-select')?.value || 'json', isGraphQLMode() ? graphqlBodyManager : null)
    };
    const core = new CoreExecutionService(getRequestPipeline(), window.backendAPI);
    const snapshot = Promise.all([core.captureContext([endpoint?.collectionId]), core.captureManual(captured)])
        .then(value => ({ value }), error => ({ error }));
    const requestTabId = await getActiveTabId();
    const previous = manualExecutions.get(requestTabId);
    previous?.cancel().catch(() => {});
    const execution = core.createExecution();
    manualExecutions.set(requestTabId, execution);
    const isCurrent = () => manualExecutions.get(requestTabId) === execution && !execution.cancelled;
    const untrack = trackInFlight(requestTabId, execution.executionId);
    setRequestInProgress(true);
    const { schemaController } = app;
    let requestConfig = { ...captured.inputs, requestId: execution.executionId };
    let scriptContext = { endpoint, environmentName: null };
    let historySensitive = {};
    let refreshedAuth;
    try {
        await schemaController?.editor?.__ready;
        const schemaSnapshot = schemaController?.captureSchema();
        scheduleEndpointSave();
        const capturedSnapshot = await snapshot;
        if (capturedSnapshot.error) { throw capturedSnapshot.error; }
        const [context, request] = capturedSnapshot.value;
        scriptContext = { endpoint, environmentName: context.environmentName };
        if (!isCurrent()) { return; }
        displayResponseWithLineNumbersForTab('Sending request...', null, requestTabId);
        clearResponsePanes(requestTabId, globalResponseElements());
        const result = await core.execute('request', { request, context }, execution, event => {
            if (event.kind === 'script') {
                const panel = app.scriptController?.consolePanel;
                if (event.data.phase === 'test') { panel?.showTestResults(event.data.result); }
                else if (event.data.result.logs?.length || event.data.result.errors?.length) {
                    panel?.show(event.data.result.logs, event.data.result.errors);
                }
            } else if (event.kind === 'warning') { toast.warning(executionError(event.data)); }
            else if (event.kind === 'effect' && event.data.kind === 'auth' && event.data.source?.kind === 'request') { refreshedAuth = event.data.changes; }
        }, isCurrent);
        if (!isCurrent()) { return; }
        if (refreshedAuth && await isTabCurrentlyActive(requestTabId) &&
            app.authManager?.getAuthConfig?.()?.config?.token === captured.authConfig?.config?.token) {
            app.authManager?.applyTokenResult?.({ success: true, accessToken: refreshedAuth.token,
                refreshToken: refreshedAuth.refreshToken,
                expiresIn: refreshedAuth.expiresAt ? Math.max(0, (refreshedAuth.expiresAt - Date.now()) / 1000) : null });
        }
        requestConfig = { ...(result.requestConfig || requestConfig), requestId: execution.executionId };
        historySensitive = result.historySensitive || {};
        if (result.apiResponse?.status) {
            await handleReceivedResponse(result.apiResponse, { requestConfig, requestTabId, url: requestConfig.url,
                historySensitive, schemaController, schemaSnapshot, scriptContext });
            if (result.executionError?.code === 'persistenceFailed') { toast.error(result.error); }
        } else if (result.status === 'skipped') {
            const message = translate('runner.flow.skipped', 'Skipped by pre-request script');
            displayResponseWithLineNumbersForTab(message, null, requestTabId);
            await showStatusIfActive(requestTabId, message);
        } else {
            throw Object.assign(new Error(result.error || 'Request failed'), result.apiResponse || {});
        }
    } catch (error) {
        if (isCurrent()) { await handleSendError(error, { requestConfig, requestTabId, historySensitive, scriptContext }); }
    } finally {
        untrack();
        if (manualExecutions.get(requestTabId) === execution) {
            manualExecutions.delete(requestTabId);
            if (await isTabCurrentlyActive(requestTabId)) { setRequestInProgress(false); }
        }
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
async function handleReceivedResponse(result, { requestConfig, requestTabId, url, historySensitive, schemaController, schemaSnapshot, scriptContext }) {
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


    if (await isTabCurrentlyActive(requestTabId)) {
        updateStatusDisplay(`Status: ${result.status} ${result.statusText || ''}`.trim(), result.status);
        updateResponseTime(result.ttfb);
        updateResponseSize(result.size);
        setRequestInProgress(false);
    }

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

    await recordRequestOutcome(requestConfig, result, { ...result, cookies }, historySensitive, scriptContext);

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
    send: sendWebSocketMessage,
    cancel: handleWebSocketCancel,
    isLive: isWebSocketLive,
    connectionState: getWebSocketState,
    isSending: isWebSocketSending
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
