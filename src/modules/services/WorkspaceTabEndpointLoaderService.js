/**
 * @fileoverview Loads collection endpoints into workspace tabs
 * @module services/WorkspaceTabEndpointLoaderService
 */

/**
 * Handles protocol-specific endpoint mapping and tab restoration for workspace tabs.
 */
export class WorkspaceTabEndpointLoaderService {
    /**
     * @param {Object} options - Loader dependencies
     * @param {WorkspaceTabService} options.service - Workspace tab service
     * @param {WorkspaceTabStateManager} options.stateManager - Workspace tab state manager
     * @param {ResponseContainerManager} options.responseContainerManager - Response container manager
     * @param {WorkspaceTabBar} options.tabBar - Workspace tab bar
     * @param {Function} options.updateUIForTabType - Updates request/runner UI visibility
     * @param {Function} options.restoreTabStateSafely - Restores tab state with controller guard handling
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
            const tabUpdate = this.createTabUpdate(endpoint);
            const tab = await this.service.updateTab(targetTabId, tabUpdate);

            if (tab) {
                await this.activateLoadedTab(tab, targetTabId, tabUpdate.name);
            }

            await this.loadScriptsForEndpoint(endpoint);
        } catch (error) {
            void error;
        }
    }

    createTabUpdate(endpoint) {
        if (endpoint.protocol === 'grpc') {
            return this.createGrpcTabUpdate(endpoint);
        }

        if (endpoint.protocol === 'websocket') {
            return this.createWebSocketTabUpdate(endpoint);
        }

        return this.createHttpTabUpdate(endpoint);
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
                    useTls: grpcData.useTls || false
                }
            },
            isModified: false
        };
    }

    createWebSocketTabUpdate(endpoint) {
        const queryParams = this.arrayEntriesToObject(endpoint.persistedQueryParams);
        const headers = this.arrayEntriesToObject(endpoint.persistedHeaders);
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
                fullUrl = fullUrl.replace(singleBraceParamRegex, `{{${key}}}`);
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
            return this.arrayEntriesToObject(endpoint.persistedQueryParams);
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
            return this.arrayEntriesToObject(endpoint.persistedHeaders);
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
        if (endpoint.persistedBody) {
            return endpoint.persistedBody;
        }

        if (endpoint.requestBodyString) {
            return endpoint.requestBodyString;
        }

        if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            return JSON.stringify({ 'data': 'example' }, null, 2);
        }

        return '';
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
            authType: 'none',
            authConfig: {}
        };
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
        if (window.scriptController && endpoint.collectionId && endpoint.id) {
            await window.scriptController.loadScriptsForEndpoint(endpoint.collectionId, endpoint.id);
        }
    }
}
