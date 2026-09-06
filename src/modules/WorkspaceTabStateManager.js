import { getCurrentEndpoint, setCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { parseKeyValuePairs, parseKeyValueRows, populateKeyValueList, clearKeyValueList, addKeyValueRow, updateUrlFromQueryParams } from './keyValueManager.js';
import { authManager } from './authManager.js';
import { displayResponseWithLineNumbersForTab, clearResponseDisplayForTab, clearSchemaValidationBadge, clearGraphQLErrorsBadge } from './apiHandler.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';

import { displayPerformanceMetrics, clearPerformanceMetrics } from './performanceMetrics.js';
import { formatCookiesAsHtml } from './cookieParser.js';
import { activateTab } from './tabManager.js';
import { setRequestBodyContent, getRequestBodyContent } from './requestBodyHelper.js';
import { setRequestMode, RequestMode, getCurrentMode } from './requestModeManager.js';
import { getProtocol, resolveProtocolId } from './protocols/protocolRegistry.js';

/** @type {Object<string, string>} */
const CAPTURE_BY_PROTOCOL = Object.freeze({
    http: '_captureHttp',
    sse: '_captureSse',
    websocket: '_captureWebSocket',
    graphql: '_captureGraphQL',
    grpc: '_captureGrpc',
    mqtt: '_captureMqtt'
});

/** @type {Object<string, string>} */
const RESTORE_BY_PROTOCOL = Object.freeze({
    http: '_restoreHttp',
    sse: '_restoreSse',
    websocket: '_restoreWebSocket',
    graphql: '_restoreGraphQL',
    grpc: '_restoreGrpc',
    mqtt: '_restoreMqtt'
});

/** @returns {Object} */
function defaultHttpRequest() {
    return {
        protocol: 'http',
        url: '',
        method: 'GET',
        pathParams: {},
        queryParams: {},
        headers: { 'Content-Type': 'application/json' },
        body: '',
        authType: 'none',
        authConfig: {}
    };
}

export class WorkspaceTabStateManager {
    constructor(domElements) {
        this.dom = domElements;
        this.graphqlBodyManager = domElements.graphqlBodyManager || null;
    }

    /** @returns {Promise<Object>} */
    async captureCurrentState() {
        return this[CAPTURE_BY_PROTOCOL[resolveProtocolId(getCurrentMode())]]();
    }

    /**
     * @param {Object|function(Object): Object} extra
     * @returns {?Object}
     */
    _endpointRef(extra) {
        const current = getCurrentEndpoint();
        if (!current) {
            return null;
        }
        return {
            collectionId: current.collectionId,
            endpointId: current.endpointId,
            ...(typeof extra === 'function' ? extra(current) : extra)
        };
    }

    /** @returns {{pathParams: Object, queryParams: Object[], headers: Object[]}} */
    _captureStreamKeyValues() {
        return {
            pathParams: {},
            queryParams: parseKeyValueRows(this.dom.queryParamsList),
            headers: parseKeyValueRows(this.dom.headersList)
        };
    }

    /** @returns {Object} */
    _captureGrpc() {
        return {
            request: {
                protocol: 'grpc',
                grpc: app.captureGrpcState ? app.captureGrpcState() : {}
            },
            endpoint: this._endpointRef({ protocol: 'grpc' })
        };
    }

    /** @returns {Object} */
    _captureSse() {
        const sseUrlInput = document.getElementById('sse-url-input');
        const sseBodyMode = document.getElementById('body-mode-select')?.value === 'text'
            ? 'text'
            : 'json';
        const authConfig = authManager.getAuthConfig();

        return {
            request: {
                protocol: 'sse',
                url: sseUrlInput?.value || this.dom.urlInput?.value || '',
                method: this.dom.methodSelect?.value || 'GET',
                ...this._captureStreamKeyValues(),
                body: {
                    mode: sseBodyMode,
                    content: sseBodyMode === 'text'
                        ? (app.requestBodyTextEditor?.getContent() || '')
                        : (getRequestBodyContent() || '')
                },
                authType: authConfig?.type || 'none',
                authConfig: authConfig?.config || {}
            },
            endpoint: this._endpointRef({ protocol: 'sse' }),
            activeResponseTab: this._getActiveResponseTab()
        };
    }

    /** @returns {Object} */
    _captureWebSocket() {
        const websocketUrlInput = document.getElementById('websocket-url-input');

        return {
            request: {
                protocol: 'websocket',
                url: websocketUrlInput?.value || this.dom.urlInput?.value || '',
                method: 'WS',
                ...this._captureStreamKeyValues(),
                body: {
                    mode: 'json',
                    content: getRequestBodyContent() || ''
                },
                authType: 'none',
                authConfig: {}
            },
            endpoint: this._endpointRef({ protocol: 'websocket' }),
            activeResponseTab: this._getActiveResponseTab()
        };
    }

    /** @returns {Object} */
    _captureMqtt() {
        const fieldValue = (id) => document.getElementById(id)?.value || '';

        return {
            request: {
                protocol: 'mqtt',
                broker: document.getElementById('mqtt-broker-input')?.value
                    || this.dom.urlInput?.value
                    || '',
                method: 'MQTT',
                clientId: fieldValue('mqtt-client-id-input'),
                username: fieldValue('mqtt-username-input'),
                password: fieldValue('mqtt-password-input'),
                subscribeTopic: fieldValue('mqtt-subscribe-input'),
                publishTopic: fieldValue('mqtt-topic-input'),
                qos: Number(document.getElementById('mqtt-qos-select')?.value) || 0,
                body: {
                    mode: 'json',
                    content: getRequestBodyContent() || ''
                },
                authType: 'none',
                authConfig: {}
            },
            endpoint: this._endpointRef({ protocol: 'mqtt' }),
            activeResponseTab: this._getActiveResponseTab()
        };
    }

    /** @returns {Object} */
    _captureGraphQL() {
        const graphqlUrlInput = document.getElementById('graphql-url-input');
        const authConfig = authManager.getAuthConfig();

        return {
            request: {
                protocol: 'graphql',
                url: graphqlUrlInput?.value || this.dom.urlInput?.value || '',
                method: 'POST',
                query: this.graphqlBodyManager ? this.graphqlBodyManager.getGraphQLQuery() : '',
                variables: this.graphqlBodyManager ? this.graphqlBodyManager.getGraphQLVariables() : '',
                operationName: this.graphqlBodyManager ? this.graphqlBodyManager.getSelectedOperationName() : null,
                headers: parseKeyValueRows(this.dom.headersList),
                authType: authConfig.type || 'none',
                authConfig: authConfig.config || {}
            },
            endpoint: this._endpointRef({ protocol: 'graphql' }),
            activeResponseTab: this._getActiveResponseTab()
        };
    }

    /** @returns {Object} */
    _captureHttpBody() {
        const currentBodyMode = document.getElementById('body-mode-select')?.value || 'json';

        if (currentBodyMode === 'formdata' && app.formBodyManager) {
            return { mode: 'formdata', fields: app.formBodyManager.getFormDataRows() };
        }
        if (currentBodyMode === 'urlencoded' && app.formBodyManager) {
            return { mode: 'urlencoded', fields: app.formBodyManager.getUrlencodedRows() };
        }
        if (currentBodyMode === 'binary' && app.formBodyManager) {
            return { mode: 'binary', ...app.formBodyManager.getBinaryBody() };
        }
        if (currentBodyMode === 'text') {
            return {
                mode: 'text',
                content: app.requestBodyTextEditor ? app.requestBodyTextEditor.getContent() : ''
            };
        }
        return { mode: 'json', content: getRequestBodyContent() || '' };
    }

    /** @returns {Object} */
    _captureHttp() {
        const authConfig = authManager.getAuthConfig();
        const containerElements = app.responseContainerManager?.getActiveElements();

        return {
            request: {
                protocol: 'http',
                url: this.dom.urlInput?.value || '',
                method: this.dom.methodSelect?.value || 'GET',
                pathParams: parseKeyValuePairs(this.dom.pathParamsList),
                queryParams: parseKeyValueRows(this.dom.queryParamsList),
                headers: parseKeyValueRows(this.dom.headersList),
                body: this._captureHttpBody(),
                authType: authConfig.type || 'none',
                authConfig: authConfig.config || {}
            },
            endpoint: this._endpointRef(current => ({
                path: current.path,
                method: current.method
            })),
            activeResponseTab: this._getActiveResponseTab(),
            previewMode: containerElements?.previewManager
                ? containerElements.previewManager.isPreviewMode(containerElements.tabId)
                : false
        };
    }

    /** @returns {string} */
    _getActiveResponseTab() {
        const activeResponseTab = document.querySelector('.response-tabs .tab-button.active');
        if (activeResponseTab) {
            return activeResponseTab.dataset.tab;
        }
        return 'response-body';
    }

    /**
     * @param {Object} tab
     * @param {Object|null} endpoint
     * @returns {void}
     */
    _applyTabEndpoint(tab, endpoint) {
        if (endpoint) {
            setCurrentEndpoint(endpoint);
            return;
        }
        if (Object.prototype.hasOwnProperty.call(tab, 'endpoint')) {
            setCurrentEndpoint(null);
        }
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async restoreTabState(tab) {
        if (!tab) {
            return;
        }

        if (!tab.request) {
            tab.request = defaultHttpRequest();
        }

        await this[RESTORE_BY_PROTOCOL[resolveProtocolId(tab.request.protocol)]](tab);
    }

    /**
     * @param {?HTMLElement} listEl
     * @param {Object} data
     * @param {Object} [options]
     * @param {string[]|false} [options.emptyRow]
     * @param {?function(): void} [options.onPopulated]
     * @returns {void}
     */
    _restoreKeyValueList(listEl, data, { emptyRow = [], onPopulated = null } = {}) {
        if (!listEl) {
            return;
        }

        clearKeyValueList(listEl);

        if (data && Object.keys(data).length > 0) {
            populateKeyValueList(listEl, data);
            onPopulated?.();
            return;
        }

        if (emptyRow !== false) {
            addKeyValueRow(listEl, ...emptyRow);
        }
    }

    /**
     * @param {string} protocolId
     * @param {string} value
     * @returns {void}
     */
    _restoreUrlInputs(protocolId, value) {
        const url = value || '';

        if (this.dom.urlInput) {
            this.dom.urlInput.value = url;
        }

        const mirrorId = getProtocol(protocolId).urlInputId;
        const mirror = mirrorId ? document.getElementById(mirrorId) : null;
        if (mirror && mirror !== this.dom.urlInput) {
            mirror.value = url;
        }
    }

    /**
     * @param {Object} request
     * @returns {void}
     */
    _restoreAuth(request) {
        if (!authManager) {
            return;
        }

        authManager.loadAuthConfig({
            type: request.authType || 'none',
            config: request.authConfig || {}
        });
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreResponseState(tab) {
        activateTab('response', tab.activeResponseTab || 'response-body');

        if (tab.response) {
            await this._restoreResponse(tab.response, tab.id);
        } else {
            this._clearResponse(tab.id);
        }
    }

    /**
     * @param {Object} request
     * @returns {void}
     */
    _restorePlainJsonBody(request) {
        if (this.graphqlBodyManager) {
            this.graphqlBodyManager.setGraphQLModeEnabled(false);
        }
        setRequestBodyContent(request.body?.content || '');
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreGrpc(tab) {
        setRequestMode(RequestMode.GRPC);
        activateTab('request', 'grpc');

        const ensureGrpcTabActive = () => {
            const activeBtn = document.querySelector('.request-config .tab-nav .tab-button.active');
            const isActiveVisible = activeBtn && activeBtn.style.display !== 'none';
            if (!isActiveVisible) {
                activateTab('request', 'grpc');
            }
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(ensureGrpcTabActive);
        } else {
            setTimeout(ensureGrpcTabActive, 0);
        }

        if (app.applyGrpcState) {
            app.applyGrpcState(tab.request.grpc || {});
        }

        this._applyTabEndpoint(tab, tab.endpoint);
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreSse(tab) {
        const { request } = tab;
        setRequestMode(RequestMode.SSE);

        this._restoreUrlInputs('sse', request.url);

        if (this.dom.methodSelect) {
            this.dom.methodSelect.value = request.method || 'GET';
        }

        if (request.body?.mode === 'text') {
            this.graphqlBodyManager?.switchMode('text');
            app.requestBodyTextEditor?.setContent(request.body.content || '');
        } else {
            this.graphqlBodyManager?.switchMode('json');
            setRequestBodyContent(request.body?.content || '');
        }

        this._restoreKeyValueList(this.dom.queryParamsList, request.queryParams, {
            onPopulated: updateUrlFromQueryParams
        });
        this._restoreKeyValueList(this.dom.headersList, request.headers);

        this._restoreAuth(request);

        await this._restoreResponseState(tab);
        this._applyTabEndpoint(tab, tab.endpoint);
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreWebSocket(tab) {
        const { request } = tab;
        setRequestMode(RequestMode.WEBSOCKET);

        this._restoreUrlInputs('websocket', request.url);
        this._restorePlainJsonBody(request);

        this._restoreKeyValueList(this.dom.queryParamsList, request.queryParams, {
            onPopulated: updateUrlFromQueryParams
        });
        this._restoreKeyValueList(this.dom.headersList, request.headers);

        await this._restoreResponseState(tab);
        this._applyTabEndpoint(tab, tab.endpoint);
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreGraphQL(tab) {
        const { request } = tab;

        this._restoreUrlInputs('graphql', request.url);

        setRequestMode(RequestMode.GRAPHQL);

        this._restoreKeyValueList(this.dom.pathParamsList, null, { emptyRow: false });
        this._restoreKeyValueList(this.dom.queryParamsList, null, { emptyRow: false });

        if (this.graphqlBodyManager) {
            this.graphqlBodyManager.setGraphQLQuery(request.query || '');
            this.graphqlBodyManager.setGraphQLVariables(request.variables || '');
            this.graphqlBodyManager.selectedOperationName = request.operationName || null;
            this.graphqlBodyManager.updateOperationPicker();
            await this.graphqlBodyManager.autoApplySchemaForUrl?.(request.url || '', { allowNetwork: true });
        }

        this._restoreKeyValueList(this.dom.headersList, request.headers);

        this._restoreAuth(request);

        await this._restoreResponseState(tab);
        this._applyTabEndpoint(tab, tab.endpoint);
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreMqtt(tab) {
        const { request } = tab;
        setRequestMode(RequestMode.MQTT);

        this._restoreUrlInputs('mqtt', request.broker);

        const setFieldValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = value;
            }
        };
        setFieldValue('mqtt-client-id-input', request.clientId || '');
        setFieldValue('mqtt-username-input', request.username || '');
        setFieldValue('mqtt-password-input', request.password || '');
        setFieldValue('mqtt-subscribe-input', request.subscribeTopic || '');
        setFieldValue('mqtt-topic-input', request.publishTopic || '');
        setFieldValue('mqtt-qos-select', String(request.qos ?? 0));

        this._restorePlainJsonBody(request);

        await this._restoreResponseState(tab);

        import('./mqttHandler.js').then(m => m.refreshMqttConnectionUi(tab.id));

        this._applyTabEndpoint(tab, tab.endpoint);
    }

    /**
     * @param {Object} request
     * @returns {void}
     */
    _restoreHttpBody(request) {
        if (!(request.body && typeof request.body === 'object' && request.body.mode)) {
            if (this.graphqlBodyManager) {
                this.graphqlBodyManager.setGraphQLModeEnabled(false);
            }
            setRequestBodyContent(typeof request.body === 'string' ? request.body : '');
            return;
        }

        const { mode } = request.body;

        if (mode === 'formdata' && app.formBodyManager) {
            this.graphqlBodyManager?.switchMode('formdata');
            app.formBodyManager.setFormDataRows(request.body.fields);
        } else if (mode === 'urlencoded' && app.formBodyManager) {
            this.graphqlBodyManager?.switchMode('urlencoded');
            app.formBodyManager.setUrlencodedRows(request.body.fields);
        } else if (mode === 'binary' && app.formBodyManager) {
            this.graphqlBodyManager?.switchMode('binary');
            app.formBodyManager.setBinaryBody(request.body);
        } else if (mode === 'text') {
            this.graphqlBodyManager?.switchMode('text');
            if (app.requestBodyTextEditor) {
                app.requestBodyTextEditor.setContent(request.body.content || '');
            }
        } else {
            if (this.graphqlBodyManager) {
                this.graphqlBodyManager.setGraphQLModeEnabled(false);
            }
            setRequestBodyContent(request.body.content || '');
        }
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreHttpEndpointContext(tab) {
        const { endpoint } = tab;

        if (endpoint) {
            setCurrentEndpoint(endpoint);

            clearSchemaValidationBadge();
            clearGraphQLErrorsBadge();

            if (app.inlineScriptManager && endpoint.collectionId && endpoint.endpointId) {
                await app.inlineScriptManager.loadScripts(endpoint.collectionId, endpoint.endpointId);
            }

            if (app.schemaController && endpoint.collectionId && endpoint.endpointId) {
                await app.schemaController.loadSchema(endpoint.collectionId, endpoint.endpointId);
            }
            return;
        }

        if (Object.prototype.hasOwnProperty.call(tab, 'endpoint')) {
            setCurrentEndpoint(null);

            clearSchemaValidationBadge();
            clearGraphQLErrorsBadge();

            if (app.inlineScriptManager) {
                await app.inlineScriptManager.clear();
            }

            if (app.schemaController) {
                await app.schemaController.clearContext();
            }
        }
    }

    /**
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async _restoreHttp(tab) {
        const { request } = tab;
        setRequestMode(RequestMode.HTTP);

        this._restoreUrlInputs('http', request.url);

        if (this.dom.methodSelect) {
            this.dom.methodSelect.value = request.method || 'GET';
        }

        this._restoreHttpBody(request);

        this._restoreKeyValueList(this.dom.pathParamsList, request.pathParams);
        this._restoreKeyValueList(this.dom.queryParamsList, request.queryParams, {
            onPopulated: updateUrlFromQueryParams
        });
        this._restoreKeyValueList(this.dom.headersList, request.headers, {
            emptyRow: ['Content-Type', 'application/json']
        });

        this._restoreAuth(request);

        await this._restoreResponseState(tab);

        if (tab.previewMode) {
            const containerElements = app.responseContainerManager?.getOrCreateContainer(tab.id);
            if (containerElements?.previewManager && !containerElements.previewManager.isPreviewMode(tab.id)) {
                containerElements.previewManager.togglePreview(tab.id);
            }
        }

        await this._restoreHttpEndpointContext(tab);
    }

    async _restoreResponse(response, tabId) {
        if (!response) {
            this._clearResponse(tabId);
            return;
        }

        const containerElements = app.responseContainerManager?.getOrCreateContainer(tabId);

        if (response.data) {
            const isStructured = typeof response.data !== 'string';
            const formattedResponse = isStructured
                ? JSON.stringify(response.data, null, 2)
                : response.data;
            const contentType = response.headers?.['content-type'] || null;
            const languageHint = isStructured ? 'json' : undefined;
            displayResponseWithLineNumbersForTab(formattedResponse, contentType, tabId, languageHint);
        } else {
            clearResponseDisplayForTab(tabId);
        }

        if (containerElements?.headersEditor) {
            if (response.headers && Object.keys(response.headers).length > 0) {
                containerElements.headersEditor.setContent(JSON.stringify(response.headers, null, 2), 'application/json');
            } else {
                containerElements.headersEditor.setContent('No response headers.', 'application/json');
            }
        }

        if (containerElements?.cookiesDisplay) {
            if (response.cookies && response.cookies.length > 0) {
                containerElements.cookiesDisplay.innerHTML = formatCookiesAsHtml(response.cookies);
            } else {
                containerElements.cookiesDisplay.innerHTML = '<div class="cookies-empty">No cookies in response</div>';
            }
        }

        if (containerElements?.performanceDisplay) {
            if (response.performanceHTML) {
                containerElements.performanceDisplay.innerHTML = response.performanceHTML;
            } else if (response.timings) {
                displayPerformanceMetrics(containerElements.performanceDisplay, response.timings, response.size);
            } else {
                clearPerformanceMetrics(containerElements.performanceDisplay);
            }
        }

        if (response.status) {
            updateStatusDisplay(`Status: ${response.status} ${response.statusText || ''}`, response.status);
        } else if (response.websocket?.state === 'open') {
            updateStatusDisplay('WebSocket connected', 101);
        } else if (response.websocket?.state === 'closed') {
            updateStatusDisplay('WebSocket closed', null);
        } else {
            updateStatusDisplay('Ready', null);
        }

        updateResponseTime(response.ttfb);

        updateResponseSize(response.size);
    }

    _clearResponse(tabId) {
        clearResponseDisplayForTab(tabId);

        updateStatusDisplay('Ready', null);

        updateResponseTime(null);
        updateResponseSize(null);

        const containerElements = app.responseContainerManager?.getOrCreateContainer(tabId);

        if (containerElements?.headersEditor) {
            containerElements.headersEditor.setContent('', 'application/json');
        }

        if (containerElements?.cookiesDisplay) {
            containerElements.cookiesDisplay.innerHTML = '';
        }

        if (containerElements?.performanceDisplay) {
            clearPerformanceMetrics(containerElements.performanceDisplay);
        }
    }

}
