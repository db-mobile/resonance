/**
 * @fileoverview Loads collection endpoints into workspace tabs
 * @module services/WorkspaceTabEndpointLoaderService
 */

import { app } from '../appContext.js';
import { getProtocol } from '../protocols/protocolRegistry.js';
import { normalizeKeyValueRows } from '../utils/keyValueRows.js';

export class WorkspaceTabEndpointLoaderService {
    /**
     * @param {Object} options
     * @param {WorkspaceTabService} options.service
     * @param {WorkspaceTabStateManager} options.stateManager
     * @param {ResponseContainerManager} options.responseContainerManager
     * @param {WorkspaceTabBar} options.tabBar
     * @param {Function} options.updateUIForTabType
     * @param {Function} options.restoreTabStateSafely
     */
    constructor({
        service,
        stateManager,
        responseContainerManager,
        tabBar,
        updateUIForTabType,
        restoreTabStateSafely
    }) {
        this.service = service;
        this.stateManager = stateManager;
        this.responseContainerManager = responseContainerManager;
        this.tabBar = tabBar;
        this.updateUIForTabType = updateUIForTabType;
        this.restoreTabStateSafely = restoreTabStateSafely;
    }

    async loadEndpoint(endpoint, targetTabId) {
        try {
            const tabUpdate = { ...this.createTabUpdate(endpoint), historyEntryId: null };
            const tab = await this.service.updateTab(targetTabId, tabUpdate);

            if (tab) {
                await this.activateLoadedTab(tab, targetTabId, tabUpdate.name);
            }

            await this.loadScriptsForEndpoint(endpoint);
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {Object} historyEntry
     * @param {string} targetTabId
     * @returns {Promise<void>}
     */
    async loadHistoryEntry(historyEntry, targetTabId) {
        try {
            const tabUpdate = this.createHistoryTabUpdate(historyEntry);
            const tab = await this.service.updateTab(targetTabId, tabUpdate);

            if (tab) {
                await this.activateLoadedTab(tab, targetTabId, tabUpdate.name);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {Object} historyEntry
     * @returns {Object}
     */
    createHistoryTabUpdate(historyEntry) {
        const request = historyEntry.request || {};
        const builders = {
            grpc: () => this.createGrpcHistoryTabUpdate(request),
            http: () => this.createHttpHistoryTabUpdate(request)
        };

        const { builder } = getProtocol(request.protocol);
        const update = (builders[builder] || builders.http)();

        return {
            ...update,
            type: 'request',
            endpoint: null,
            historyEntryId: historyEntry.id || null,
            isModified: false
        };
    }

    /**
     * @param {Object} request
     * @returns {Object}
     */
    createGrpcHistoryTabUpdate(request) {
        const grpc = request.grpc || {};
        const fullMethod = grpc.fullMethod || '';
        const service = fullMethod.replace(/^\//, '').split('/')[0] || '';
        const methodName = fullMethod.split('/').filter(Boolean).pop();
        const { body } = request;

        let requestJson;
        if (body === null || body === undefined) {
            requestJson = '{}';
        } else {
            requestJson = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
        }

        return {
            name: methodName || 'gRPC Request',
            request: {
                protocol: 'grpc',
                grpc: {
                    target: grpc.rawTarget || grpc.target || '',
                    service,
                    fullMethod,
                    requestJson,
                    metadata: request.headers || {},
                    useTls: !!grpc.useTls,
                    protoPath: grpc.protoPath || null,
                    clientStreaming: !!grpc.clientStreaming,
                    serverStreaming: !!grpc.serverStreaming
                }
            }
        };
    }

    /**
     * @param {Object} request
     * @returns {Object}
     */
    createHttpHistoryTabUpdate(request) {
        const rawUrl = request.rawUrl || request.url || '';
        const url = rawUrl.split('?')[0];
        const method = request.method || 'GET';

        return {
            name: this.service.generateTabName(method, request.url || url),
            request: {
                protocol: 'http',
                url,
                method,
                pathParams: {},
                queryParams: this.historyQueryParams(request.url),
                headers: request.headers || {},
                body: this.historyBody(request.body),
                authType: 'none',
                authConfig: {}
            }
        };
    }

    /**
     * @param {string} url
     * @returns {Object}
     */
    historyQueryParams(url) {
        const queryParams = {};
        if (!url) {
            return queryParams;
        }

        try {
            const parsed = new URL(url);
            parsed.searchParams.forEach((value, key) => {
                queryParams[key] = value;
            });
        } catch (error) {
            void error;
        }

        return queryParams;
    }

    /**
     * @param {*} body
     * @returns {{mode: string, content: string}}
     */
    historyBody(body) {
        if (body === null || body === undefined) {
            return { mode: 'json', content: '' };
        }

        if (typeof body === 'string') {
            return { mode: 'text', content: body };
        }

        return { mode: 'json', content: JSON.stringify(body, null, 2) };
    }

    /**
     * @param {Object} endpoint
     * @returns {Object}
     */
    createTabUpdate(endpoint) {
        const builders = {
            http: () => this.createHttpTabUpdate(endpoint),
            sse: () => this.createSseTabUpdate(endpoint),
            websocket: () => this.createWebSocketTabUpdate(endpoint),
            graphql: () => this.createGraphQLTabUpdate(endpoint),
            grpc: () => this.createGrpcTabUpdate(endpoint),
            mqtt: () => this.createMqttTabUpdate(endpoint)
        };

        const { builder } = getProtocol(endpoint.protocol);

        return (builders[builder] || builders.http)();
    }

    /**
     * @param {Object} endpoint
     * @returns {Object}
     */
    createSseTabUpdate(endpoint) {
        const { authType, authConfig } = this.buildHttpAuth(endpoint);
        const contentType = this.resolveBodyContentType(endpoint);
        const mode = contentType && !contentType.toLowerCase().includes('json') ? 'text' : 'json';

        return {
            name: endpoint.name || 'SSE Request',
            type: 'request',
            endpoint: {
                collectionId: endpoint.collectionId,
                endpointId: endpoint.id,
                protocol: 'sse'
            },
            request: {
                protocol: 'sse',
                url: endpoint.persistedUrl || endpoint.path || '',
                method: endpoint.method || 'GET',
                pathParams: {},
                queryParams: this.arrayEntriesToRows(endpoint.persistedQueryParams),
                headers: this.arrayEntriesToRows(endpoint.persistedHeaders),
                body: {
                    mode,
                    content: endpoint.persistedBody || ''
                },
                authType,
                authConfig
            },
            isModified: false
        };
    }

    /**
     * @param {Object} endpoint
     * @returns {Object}
     */
    createMqttTabUpdate(endpoint) {
        const mqtt = endpoint.persistedMqttData || {};

        return {
            name: endpoint.name || 'MQTT Request',
            type: 'request',
            endpoint: {
                collectionId: endpoint.collectionId,
                endpointId: endpoint.id,
                protocol: 'mqtt'
            },
            request: {
                protocol: 'mqtt',
                broker: endpoint.persistedUrl || endpoint.path || '',
                method: 'MQTT',
                clientId: mqtt.clientId || '',
                username: mqtt.username || '',
                password: '',
                subscribeTopic: mqtt.subscribeTopic || '',
                publishTopic: mqtt.publishTopic || '',
                qos: mqtt.qos || 0,
                body: {
                    mode: 'json',
                    content: endpoint.persistedBody || ''
                },
                authType: 'none',
                authConfig: {}
            },
            isModified: false
        };
    }

    createGraphQLTabUpdate(endpoint) {
        const tabName = endpoint.name || 'GraphQL Request';
        const { authType, authConfig } = this.buildHttpAuth(endpoint);
        const graphql = endpoint.persistedGraphQLData || {};

        return {
            name: tabName,
            type: 'request',
            endpoint: {
                collectionId: endpoint.collectionId,
                endpointId: endpoint.id,
                protocol: 'graphql'
            },
            request: {
                protocol: 'graphql',
                url: endpoint.persistedUrl || endpoint.path || '',
                method: 'POST',
                query: graphql.query || '',
                variables: graphql.variables || '',
                operationName: graphql.operationName || null,
                headers: this.buildHttpHeaders(endpoint),
                authType,
                authConfig
            },
            isModified: false
        };
    }

    createGrpcTabUpdate(endpoint) {
        const grpcData = endpoint.grpcData || {};
        const tabName = endpoint.name || 'gRPC Request';

        return {
            name: tabName,
            type: 'request',
            endpoint: {
                collectionId: endpoint.collectionId,
                endpointId: endpoint.id,
                protocol: 'grpc'
            },
            request: {
                protocol: 'grpc',
                grpc: {
                    target: grpcData.target || '',
                    service: grpcData.service || '',
                    fullMethod: grpcData.fullMethod || endpoint.path || '',
                    requestJson: grpcData.requestJson || '{}',
                    metadata: grpcData.metadata || {},
                    useTls: grpcData.useTls || false,
                    protoPath: grpcData.protoPath || null,
                    clientStreaming: grpcData.clientStreaming || false,
                    serverStreaming: grpcData.serverStreaming || false
                }
            },
            isModified: false
        };
    }

    createWebSocketTabUpdate(endpoint) {
        const queryParams = this.arrayEntriesToRows(endpoint.persistedQueryParams);
        const headers = this.arrayEntriesToRows(endpoint.persistedHeaders);
        const tabName = endpoint.name || 'WebSocket Request';

        return {
            name: tabName,
            type: 'request',
            endpoint: {
                collectionId: endpoint.collectionId,
                endpointId: endpoint.id,
                protocol: 'websocket'
            },
            request: {
                protocol: 'websocket',
                url: endpoint.persistedUrl || endpoint.path || '',
                method: 'WS',
                pathParams: {},
                queryParams,
                headers,
                body: {
                    mode: 'json',
                    content: endpoint.persistedBody || ''
                },
                authType: 'none',
                authConfig: {}
            },
            isModified: false
        };
    }

    createHttpTabUpdate(endpoint) {
        const tabName = endpoint.name || this.service.generateTabName(endpoint.method, endpoint.path);
        const { authType, authConfig } = this.buildHttpAuth(endpoint);

        return {
            name: tabName,
            type: 'request',
            endpoint: {
                collectionId: endpoint.collectionId,
                endpointId: endpoint.id,
                protocol: 'http'
            },
            request: {
                protocol: 'http',
                url: this.buildHttpUrl(endpoint),
                method: endpoint.method,
                pathParams: this.buildHttpPathParams(endpoint),
                queryParams: this.buildHttpQueryParams(endpoint),
                headers: this.buildHttpHeaders(endpoint),
                body: this.buildHttpBody(endpoint),
                authType,
                authConfig
            },
            isModified: false
        };
    }

    buildHttpUrl(endpoint) {
        if (endpoint.persistedUrl) {
            return endpoint.persistedUrl;
        }

        let fullUrl = endpoint.path;
        if (endpoint.collectionBaseUrl && !endpoint.path.includes('{{baseUrl}}')) {
            fullUrl = `{{baseUrl}}${  endpoint.path}`;
        }

        if (endpoint.parameters?.path) {
            Object.entries(endpoint.parameters.path).forEach(([key]) => {
                const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const singleBraceParamRegex = new RegExp(`(?<!\\{)\\{${escapedKey}\\}(?!\\})`, 'g');
                fullUrl = fullUrl.replace(singleBraceParamRegex, () => `{{${key}}}`);
            });
        }

        return fullUrl;
    }

    buildHttpPathParams(endpoint) {
        if (endpoint.persistedPathParams && endpoint.persistedPathParams.length > 0) {
            return this.arrayEntriesToObject(endpoint.persistedPathParams);
        }

        const pathParams = {};
        if (endpoint.parameters?.path) {
            Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                pathParams[key] = param.example || '';
            });
        }
        return pathParams;
    }

    buildHttpQueryParams(endpoint) {
        if (endpoint.persistedQueryParams && endpoint.persistedQueryParams.length > 0) {
            return this.arrayEntriesToRows(endpoint.persistedQueryParams);
        }

        const queryParams = {};
        if (endpoint.parameters?.query) {
            Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
                queryParams[key] = param.example || '';
            });
        }
        return queryParams;
    }

    buildHttpHeaders(endpoint) {
        if (endpoint.persistedHeaders && endpoint.persistedHeaders.length > 0) {
            return this.arrayEntriesToRows(endpoint.persistedHeaders);
        }

        const headers = {};

        if (endpoint.collectionDefaultHeaders) {
            Object.entries(endpoint.collectionDefaultHeaders).forEach(([key, value]) => {
                headers[key] = value;
            });
        }

        if (endpoint.parameters?.header) {
            Object.entries(endpoint.parameters.header).forEach(([key, param]) => {
                headers[key] = param.example || '';
            });
        }

        if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && !headers['Content-Type']) {
            headers['Content-Type'] = endpoint.requestBody?.contentType || 'application/json';
        }

        return headers;
    }

    buildHttpBody(endpoint) {
        const formBody = endpoint.persistedFormBodyData;
        if (formBody && (formBody.mode === 'formdata' || formBody.mode === 'urlencoded')) {
            return { mode: formBody.mode, fields: formBody.fields || {} };
        }
        if (formBody && formBody.mode === 'text') {
            return { mode: 'text', content: formBody.content || '' };
        }

        const graphql = endpoint.persistedGraphQLData;
        if (graphql && graphql.mode === 'graphql') {
            return {
                mode: 'graphql',
                query: graphql.query || '',
                variables: graphql.variables || ''
            };
        }

        const importedType = endpoint.requestBody?.type;
        if (importedType === 'formdata' || importedType === 'urlencoded') {
            return { mode: importedType, fields: endpoint.requestBody.fields || {} };
        }

        let content;
        if (endpoint.persistedBody) {
            content = endpoint.persistedBody;
        } else if (endpoint.requestBodyString) {
            content = endpoint.requestBodyString;
        } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            content = JSON.stringify({ 'data': 'example' }, null, 2);
        } else {
            content = '';
        }

        const contentType = this.resolveBodyContentType(endpoint);
        const mode = contentType && !contentType.toLowerCase().includes('json') ? 'text' : 'json';

        return { mode, content };
    }

    resolveBodyContentType(endpoint) {
        if (endpoint.persistedHeaders && endpoint.persistedHeaders.length > 0) {
            const match = endpoint.persistedHeaders.find(
                entry => entry.key && entry.enabled !== false && entry.key.toLowerCase() === 'content-type'
            );
            if (match) {
                return match.value || '';
            }
        }

        if (endpoint.collectionDefaultHeaders) {
            const key = Object.keys(endpoint.collectionDefaultHeaders).find(
                name => name.toLowerCase() === 'content-type'
            );
            if (key) {
                return endpoint.collectionDefaultHeaders[key] || '';
            }
        }

        if (endpoint.parameters?.header) {
            const key = Object.keys(endpoint.parameters.header).find(
                name => name.toLowerCase() === 'content-type'
            );
            if (key) {
                return endpoint.parameters.header[key]?.example || '';
            }
        }

        return endpoint.requestBody?.contentType || '';
    }

    buildHttpAuth(endpoint) {
        if (endpoint.persistedAuthConfig) {
            return {
                authType: endpoint.persistedAuthConfig.type || 'none',
                authConfig: endpoint.persistedAuthConfig.config || {}
            };
        }

        if (endpoint.security) {
            return {
                authType: endpoint.security.type || 'none',
                authConfig: endpoint.security.config || {}
            };
        }

        return {
            authType: 'inherit',
            authConfig: {}
        };
    }

    /**
     * @param {Array<Object>} entries
     * @returns {Array<Object>}
     */
    arrayEntriesToRows(entries = []) {
        return normalizeKeyValueRows(entries);
    }

    arrayEntriesToObject(entries = []) {
        const result = {};
        entries.forEach(entry => {
            result[entry.key] = entry.value;
        });
        return result;
    }

    async activateLoadedTab(tab, tabId, tabName) {
        this.updateUIForTabType(tab);
        this.responseContainerManager.showContainer(tabId);
        this.tabBar.updateTab(tabId, { name: tabName, isModified: false });
        await this.restoreTabStateSafely(tab);
    }

    async loadScriptsForEndpoint(endpoint) {
        if (app.scriptController && endpoint.collectionId && endpoint.id) {
            await app.scriptController.loadScriptsForEndpoint(endpoint.collectionId, endpoint.id);
        }
    }
}
