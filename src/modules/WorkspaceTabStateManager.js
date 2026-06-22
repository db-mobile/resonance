/**
 * WorkspaceTabStateManager
 *
 * Manages capturing and restoring tab state from/to UI elements.
 * Bridges workspace tabs with the existing UI.
 */
import { getCurrentEndpoint, setCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { parseKeyValuePairs, populateKeyValueList, clearKeyValueList, addKeyValueRow, updateUrlFromQueryParams } from './keyValueManager.js';
import { authManager } from './authManager.js';
import { displayResponseWithLineNumbersForTab, clearResponseDisplayForTab, clearSchemaValidationBadge, clearGraphQLErrorsBadge } from './apiHandler.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import logger from './logger.js';

const _log = logger.scope('WorkspaceTabStateManager');
import { displayPerformanceMetrics, clearPerformanceMetrics } from './performanceMetrics.js';
import { formatCookiesAsHtml } from './cookieParser.js';
import { activateTab } from './tabManager.js';
import { setRequestBodyContent, getRequestBodyContent } from './requestBodyHelper.js';
import { setRequestMode, RequestMode } from './requestModeManager.js';

export class WorkspaceTabStateManager {
    constructor(domElements) {
        this.dom = domElements;
        this.graphqlBodyManager = domElements.graphqlBodyManager || null;
    }

    /**
     * Capture current state from UI elements
     * @returns {Promise<Object>}
     */
    async captureCurrentState() {
        const { isGrpcMode, isWebSocketMode, isSseMode, isMqttMode, isGraphQLMode } = await import('./requestModeManager.js');
        
        if (isGrpcMode()) {
            const grpcRequestJson = app.grpcBodyEditor
                ? app.grpcBodyEditor.getContent()
                : (this.dom.grpcBodyInput?.value || '{}');
            
            const metadata = {};
            const grpcMetadataList = document.getElementById('grpc-metadata-list');
            if (grpcMetadataList) {
                grpcMetadataList.querySelectorAll('.key-value-row').forEach(row => {
                    const key = row.querySelector('.key-input')?.value?.trim();
                    const value = row.querySelector('.value-input')?.value || '';
                    if (key) {
                        metadata[key] = value;
                    }
                });
            }
            
            const grpcTlsCheckbox = document.getElementById('grpc-tls-checkbox');
            const useTls = grpcTlsCheckbox?.checked || false;
            
            return {
                request: {
                    protocol: 'grpc',
                    grpc: {
                        target: this.dom.grpcTargetInput?.value || '',
                        service: this.dom.grpcServiceSelect?.value || '',
                        fullMethod: this.dom.grpcMethodSelect?.value || '',
                        requestJson: grpcRequestJson || '{}',
                        metadata,
                        useTls
                    }
                },
                endpoint: getCurrentEndpoint()
                    ? {
                          collectionId: getCurrentEndpoint().collectionId,
                          endpointId: getCurrentEndpoint().endpointId,
                          protocol: 'grpc'
                      }
                    : null
            };
        }

        if (isSseMode()) {
            const sseUrlInput = document.getElementById('sse-url-input');
            return {
                request: {
                    protocol: 'sse',
                    url: sseUrlInput?.value || this.dom.urlInput?.value || '',
                    method: 'GET',
                    pathParams: {},
                    queryParams: parseKeyValuePairs(this.dom.queryParamsList),
                    headers: parseKeyValuePairs(this.dom.headersList),
                    body: { mode: 'none', content: '' },
                    authType: 'none',
                    authConfig: {}
                },
                endpoint: getCurrentEndpoint()
                    ? {
                          collectionId: getCurrentEndpoint().collectionId,
                          endpointId: getCurrentEndpoint().endpointId,
                          protocol: 'sse'
                      }
                    : null,
                activeResponseTab: this._getActiveResponseTab()
            };
        }

        if (isWebSocketMode()) {
            const websocketUrlInput = document.getElementById('websocket-url-input');

            return {
                request: {
                    protocol: 'websocket',
                    url: websocketUrlInput?.value || this.dom.urlInput?.value || '',
                    method: 'WS',
                    pathParams: {},
                    queryParams: parseKeyValuePairs(this.dom.queryParamsList),
                    headers: parseKeyValuePairs(this.dom.headersList),
                    body: {
                        mode: 'json',
                        content: getRequestBodyContent() || ''
                    },
                    authType: 'none',
                    authConfig: {}
                },
                endpoint: getCurrentEndpoint()
                    ? {
                          collectionId: getCurrentEndpoint().collectionId,
                          endpointId: getCurrentEndpoint().endpointId,
                          protocol: 'websocket'
                      }
                    : null,
                activeResponseTab: this._getActiveResponseTab()
            };
        }

        if (isMqttMode()) {
            const mqttBrokerInput = document.getElementById('mqtt-broker-input');

            return {
                request: {
                    protocol: 'mqtt',
                    broker: mqttBrokerInput?.value || this.dom.urlInput?.value || '',
                    method: 'MQTT',
                    clientId: document.getElementById('mqtt-client-id-input')?.value || '',
                    username: document.getElementById('mqtt-username-input')?.value || '',
                    password: document.getElementById('mqtt-password-input')?.value || '',
                    subscribeTopic: document.getElementById('mqtt-subscribe-input')?.value || '',
                    publishTopic: document.getElementById('mqtt-topic-input')?.value || '',
                    qos: Number(document.getElementById('mqtt-qos-select')?.value) || 0,
                    body: {
                        mode: 'json',
                        content: getRequestBodyContent() || ''
                    },
                    authType: 'none',
                    authConfig: {}
                },
                endpoint: getCurrentEndpoint()
                    ? {
                          collectionId: getCurrentEndpoint().collectionId,
                          endpointId: getCurrentEndpoint().endpointId,
                          protocol: 'mqtt'
                      }
                    : null,
                activeResponseTab: this._getActiveResponseTab()
            };
        }

        if (isGraphQLMode()) {
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
                    headers: parseKeyValuePairs(this.dom.headersList),
                    authType: authConfig.type || 'none',
                    authConfig: authConfig.config || {}
                },
                endpoint: getCurrentEndpoint()
                    ? {
                          collectionId: getCurrentEndpoint().collectionId,
                          endpointId: getCurrentEndpoint().endpointId,
                          protocol: 'graphql'
                      }
                    : null,
                activeResponseTab: this._getActiveResponseTab()
            };
        }

        const pathParams = parseKeyValuePairs(this.dom.pathParamsList);
        const queryParams = parseKeyValuePairs(this.dom.queryParamsList);
        const headers = parseKeyValuePairs(this.dom.headersList);

        const authConfig = authManager.getAuthConfig();

        const activeResponseTab = this._getActiveResponseTab();

        const bodyModeSelect = document.getElementById('body-mode-select');
        const currentBodyMode = bodyModeSelect?.value || 'json';
        let bodyData;
        if (currentBodyMode === 'formdata' && app.formBodyManager) {
            bodyData = {
                mode: 'formdata',
                fields: app.formBodyManager.getFormDataFields()
            };
        } else if (currentBodyMode === 'urlencoded' && app.formBodyManager) {
            bodyData = {
                mode: 'urlencoded',
                fields: app.formBodyManager.getUrlencodedFields()
            };
        } else if (currentBodyMode === 'text') {
            bodyData = {
                mode: 'text',
                content: app.requestBodyTextEditor
                    ? app.requestBodyTextEditor.getContent()
                    : ''
            };
        } else {
            bodyData = {
                mode: 'json',
                content: getRequestBodyContent() || ''
            };
        }

        const containerElements = app.responseContainerManager?.getActiveElements();
        const previewMode = containerElements?.previewManager
            ? containerElements.previewManager.isPreviewMode(containerElements.tabId)
            : false;

        return {
            request: {
                protocol: 'http',
                url: this.dom.urlInput?.value || '',
                method: this.dom.methodSelect?.value || 'GET',
                pathParams,
                queryParams,
                headers,
                body: bodyData,
                authType: authConfig.type || 'none',
                authConfig: authConfig.config || {}
            },
            endpoint: getCurrentEndpoint() ? {
                collectionId: getCurrentEndpoint().collectionId,
                endpointId: getCurrentEndpoint().endpointId,
                path: getCurrentEndpoint().path,
                method: getCurrentEndpoint().method
            } : null,
            activeResponseTab: activeResponseTab,
            previewMode: previewMode
        };
    }

    /**
     * Get the currently active response tab ID
     * @private
     * @returns {string}
     */
    _getActiveResponseTab() {
        const activeResponseTab = document.querySelector('.response-tabs .tab-button.active');
        if (activeResponseTab) {
            return activeResponseTab.dataset.tab;
        }
        return 'response-body';
    }

    /**
     * Restore tab state to UI elements
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async restoreTabState(tab) {
        if (!tab) {
            return;
        }

        if (!tab.request) {
            tab.request = {
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

        const {request} = tab;
        const {response} = tab;
        const {endpoint} = tab;

        if (request.protocol === 'grpc') {
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
            
            if (this.dom.grpcTargetInput) {
                this.dom.grpcTargetInput.value = request.grpc?.target || '';
            }
            if (this.dom.grpcBodyInput) {
                this.dom.grpcBodyInput.value = request.grpc?.requestJson || '{}';
            }
            if (app.grpcBodyEditor) {
                app.grpcBodyEditor.setContent(request.grpc?.requestJson || '{}');
            }
            if (this.dom.grpcServiceSelect) {
                this.dom.grpcServiceSelect.value = request.grpc?.service || '';
            }
            if (this.dom.grpcMethodSelect) {
                this.dom.grpcMethodSelect.value = request.grpc?.fullMethod || '';
            }
            if (app.setGrpcMetadata) {
                app.setGrpcMetadata(request.grpc?.metadata || {});
            }
            if (app.setGrpcTls) {
                app.setGrpcTls(request.grpc?.useTls || false);
            }
            
            if (endpoint) {
                setCurrentEndpoint(endpoint);
            }
            return;
        }

        if (request.protocol === 'sse') {
            setRequestMode(RequestMode.SSE);

            if (this.dom.urlInput) {
                this.dom.urlInput.value = request.url || '';
            }
            const sseUrlInput = document.getElementById('sse-url-input');
            if (sseUrlInput) {
                sseUrlInput.value = request.url || '';
            }

            if (this.dom.queryParamsList) {
                clearKeyValueList(this.dom.queryParamsList);
                if (request.queryParams && Object.keys(request.queryParams).length > 0) {
                    populateKeyValueList(this.dom.queryParamsList, request.queryParams);
                    updateUrlFromQueryParams();
                } else {
                    addKeyValueRow(this.dom.queryParamsList);
                }
            }

            if (this.dom.headersList) {
                clearKeyValueList(this.dom.headersList);
                if (request.headers && Object.keys(request.headers).length > 0) {
                    populateKeyValueList(this.dom.headersList, request.headers);
                } else {
                    addKeyValueRow(this.dom.headersList);
                }
            }

            const activeResponseTab = tab.activeResponseTab || 'response-body';
            activateTab('response', activeResponseTab);

            if (response) {
                await this._restoreResponse(response, tab.id);
            } else {
                this._clearResponse(tab.id);
            }

            if (endpoint) {
                setCurrentEndpoint(endpoint);
            }
            return;
        }

        if (request.protocol === 'websocket') {
            setRequestMode(RequestMode.WEBSOCKET);

            if (this.dom.urlInput) {
                this.dom.urlInput.value = request.url || '';
            }
            const websocketUrlInput = document.getElementById('websocket-url-input');
            if (websocketUrlInput) {
                websocketUrlInput.value = request.url || '';
            }

            if (this.graphqlBodyManager) {
                this.graphqlBodyManager.setGraphQLModeEnabled(false);
            }
            setRequestBodyContent(request.body?.content || '');

            if (this.dom.queryParamsList) {
                clearKeyValueList(this.dom.queryParamsList);
                if (request.queryParams && Object.keys(request.queryParams).length > 0) {
                    populateKeyValueList(this.dom.queryParamsList, request.queryParams);
                    updateUrlFromQueryParams();
                } else {
                    addKeyValueRow(this.dom.queryParamsList);
                }
            }

            if (this.dom.headersList) {
                clearKeyValueList(this.dom.headersList);
                if (request.headers && Object.keys(request.headers).length > 0) {
                    populateKeyValueList(this.dom.headersList, request.headers);
                } else {
                    addKeyValueRow(this.dom.headersList);
                }
            }

            const activeResponseTab = tab.activeResponseTab || 'response-body';
            activateTab('response', activeResponseTab);

            if (response) {
                await this._restoreResponse(response, tab.id);
            } else {
                this._clearResponse(tab.id);
            }

            if (endpoint) {
                setCurrentEndpoint(endpoint);
            }
            return;
        }

        if (request.protocol === 'graphql') {
            setRequestMode(RequestMode.GRAPHQL);

            if (this.dom.urlInput) {
                this.dom.urlInput.value = request.url || '';
            }
            const graphqlUrlInput = document.getElementById('graphql-url-input');
            if (graphqlUrlInput) {
                graphqlUrlInput.value = request.url || '';
            }

            if (this.dom.pathParamsList) {
                clearKeyValueList(this.dom.pathParamsList);
            }
            if (this.dom.queryParamsList) {
                clearKeyValueList(this.dom.queryParamsList);
            }

            if (this.graphqlBodyManager) {
                this.graphqlBodyManager.setGraphQLQuery(request.query || '');
                this.graphqlBodyManager.setGraphQLVariables(request.variables || '');
                this.graphqlBodyManager.selectedOperationName = request.operationName || null;
                this.graphqlBodyManager.updateOperationPicker();
            }

            if (this.dom.headersList) {
                clearKeyValueList(this.dom.headersList);
                if (request.headers && Object.keys(request.headers).length > 0) {
                    populateKeyValueList(this.dom.headersList, request.headers);
                } else {
                    addKeyValueRow(this.dom.headersList);
                }
            }

            if (authManager) {
                authManager.loadAuthConfig({
                    type: request.authType || 'none',
                    config: request.authConfig || {}
                });
            }

            const activeResponseTab = tab.activeResponseTab || 'response-body';
            activateTab('response', activeResponseTab);

            if (response) {
                await this._restoreResponse(response, tab.id);
            } else {
                this._clearResponse(tab.id);
            }

            if (endpoint) {
                setCurrentEndpoint(endpoint);
            }
            return;
        }

        if (request.protocol === 'mqtt') {
            setRequestMode(RequestMode.MQTT);

            if (this.dom.urlInput) {
                this.dom.urlInput.value = request.broker || '';
            }
            const mqttBrokerInput = document.getElementById('mqtt-broker-input');
            if (mqttBrokerInput) {
                mqttBrokerInput.value = request.broker || '';
            }

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

            if (this.graphqlBodyManager) {
                this.graphqlBodyManager.setGraphQLModeEnabled(false);
            }
            setRequestBodyContent(request.body?.content || '');

            const activeResponseTab = tab.activeResponseTab || 'response-body';
            activateTab('response', activeResponseTab);

            if (response) {
                await this._restoreResponse(response, tab.id);
            } else {
                this._clearResponse(tab.id);
            }

            import('./mqttHandler.js').then(m => m.refreshMqttConnectionUi(tab.id));

            if (endpoint) {
                setCurrentEndpoint(endpoint);
            }
            return;
        }

        setRequestMode(RequestMode.HTTP);

        if (this.dom.urlInput) {
            this.dom.urlInput.value = request.url || '';
        }

        if (this.dom.methodSelect) {
            this.dom.methodSelect.value = request.method || 'GET';
        }

        if (request.body && typeof request.body === 'object' && request.body.mode) {
            const { mode } = request.body;
            if (mode === 'formdata' && app.formBodyManager) {
                this.graphqlBodyManager?.switchMode('formdata');
                app.formBodyManager.setFormDataFields(request.body.fields || {});
            } else if (mode === 'urlencoded' && app.formBodyManager) {
                this.graphqlBodyManager?.switchMode('urlencoded');
                app.formBodyManager.setUrlencodedFields(request.body.fields || {});
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
        } else {
            if (this.graphqlBodyManager) {
                this.graphqlBodyManager.setGraphQLModeEnabled(false);
            }
            setRequestBodyContent(typeof request.body === 'string' ? request.body : '');
        }

        if (this.dom.pathParamsList) {
            clearKeyValueList(this.dom.pathParamsList);
            if (request.pathParams && Object.keys(request.pathParams).length > 0) {
                populateKeyValueList(this.dom.pathParamsList, request.pathParams);
            } else {
                addKeyValueRow(this.dom.pathParamsList);
            }
        }

        if (this.dom.queryParamsList) {
            clearKeyValueList(this.dom.queryParamsList);
            if (request.queryParams && Object.keys(request.queryParams).length > 0) {
                populateKeyValueList(this.dom.queryParamsList, request.queryParams);
                updateUrlFromQueryParams();
            } else {
                addKeyValueRow(this.dom.queryParamsList);
            }
        }

        if (this.dom.headersList) {
            clearKeyValueList(this.dom.headersList);
            if (request.headers && Object.keys(request.headers).length > 0) {
                populateKeyValueList(this.dom.headersList, request.headers);
            } else {
                addKeyValueRow(this.dom.headersList, 'Content-Type', 'application/json');
            }
        }

        if (authManager) {
            const authType = request.authType || 'none';
            const authConfig = {
                type: authType,
                config: request.authConfig || {}
            };
            authManager.loadAuthConfig(authConfig);
        }

        const activeResponseTab = tab.activeResponseTab || 'response-body';
        activateTab('response', activeResponseTab);

        if (response) {
            await this._restoreResponse(response, tab.id);
        } else {
            this._clearResponse(tab.id);
        }

        if (tab.previewMode) {
            const containerElements = app.responseContainerManager?.getOrCreateContainer(tab.id);
            if (containerElements?.previewManager) {
                if (!containerElements.previewManager.isPreviewMode(tab.id)) {
                    containerElements.previewManager.togglePreview(tab.id);
                }
            }
        }

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
        } else if (Object.prototype.hasOwnProperty.call(tab, 'endpoint')) {
            setCurrentEndpoint(null);

            clearSchemaValidationBadge();
            clearGraphQLErrorsBadge();

            if (app.inlineScriptManager) {
                app.inlineScriptManager.clear();
            }

            if (app.schemaController) {
                app.schemaController.clearContext();
            }
        }
    }

    /**
     * Update tab with response data
     * @param {string} tabId
     * @param {Object} responseData
     * @returns {Object} Update object for tab
     */
    captureResponse(responseData) {
        return {
            response: {
                data: responseData.data,
                headers: responseData.headers || {},
                status: responseData.status,
                statusText: responseData.statusText,
                ttfb: responseData.ttfb,
                size: responseData.size,
                timings: responseData.timings,
                cookies: responseData.cookies || []
            }
        };
    }

    /**
     * Restore response to UI (private)
     * @private
     */
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

    /**
     * Clear response display
     * @private
     */
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

    /**
     * Create a new empty state
     * @returns {Object}
     */
    createEmptyState() {
        return {
            request: {
                protocol: 'http',
                url: '',
                method: 'GET',
                pathParams: {},
                queryParams: {},
                headers: { 'Content-Type': 'application/json' },
                body: { mode: 'json', content: '' },
                authType: 'none',
                authConfig: {}
            },
            response: null,
            endpoint: null,
            activeResponseTab: 'response-body'
        };
    }
}
