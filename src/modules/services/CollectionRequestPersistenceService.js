/**
 * @fileoverview Persists collection request edits from the request UI
 * @module services/CollectionRequestPersistenceService
 */

import { getRequestBodyContent } from '../requestBodyHelper.js';

/**
 * Handles saving request edits for HTTP, WebSocket, and gRPC collection endpoints.
 */
export class CollectionRequestPersistenceService {
    /**
     * @param {Object} options - Persistence dependencies
     * @param {CollectionRepository} options.repository - Collection repository
     * @param {CollectionService} options.collectionService - Collection service
     * @param {IStatusDisplay} options.statusDisplay - Status display adapter
     * @param {Function} options.refreshCollections - Callback to refresh the collection tree
     */
    constructor({ repository, collectionService, statusDisplay, refreshCollections }) {
        this.repository = repository;
        this.collectionService = collectionService;
        this.statusDisplay = statusDisplay;
        this.refreshCollections = refreshCollections;
    }

    async saveRequestBodyModification(collectionId, endpointId) {
        const bodyInput = document.getElementById('body-input');
        if (bodyInput) {
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }
    }

    async saveAllRequestModifications(collectionId, endpointId) {
        try {
            const { parseKeyValuePairs } = await import('../keyValueManager.js');
            const { authManager } = await import('../authManager.js');

            const collections = await this.repository.getAll();
            const collection = collections.find(c => c.id === collectionId);
            if (!collection) {
                return;
            }

            const endpointLocations = this.findAllEndpointLocations(collection, endpointId);
            const endpoint = endpointLocations.length > 0 ? endpointLocations[0].endpoint : null;
            const isGrpc = endpoint && endpoint.protocol === 'grpc';
            const isWebSocket = endpoint && endpoint.protocol === 'websocket';

            if (isGrpc) {
                await this.saveGrpcRequest(collectionId, endpointId, endpoint, endpointLocations, collections);
                return;
            }

            if (isWebSocket) {
                await this.saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs);
                return;
            }

            await this.saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager);
        } catch (error) {
            this.statusDisplay.update(`Error saving request: ${error.message}`, null);
            throw error;
        }
    }

    async saveGrpcRequest(collectionId, endpointId, endpoint, endpointLocations, collections) {
        const grpcTargetInput = document.getElementById('grpc-target-input');
        const grpcServiceSelect = document.getElementById('grpc-service-select');
        const grpcMethodSelect = document.getElementById('grpc-method-select');
        const grpcBodyInput = document.getElementById('grpc-body-input');
        const grpcMetadataList = document.getElementById('grpc-metadata-list');
        const grpcTlsCheckbox = document.getElementById('grpc-tls-checkbox');

        const metadata = {};
        if (grpcMetadataList) {
            grpcMetadataList.querySelectorAll('.key-value-row').forEach(row => {
                const key = row.querySelector('.key-input')?.value?.trim();
                const value = row.querySelector('.value-input')?.value || '';
                if (key) {
                    metadata[key] = value;
                }
            });
        }

        const requestJson = window.grpcBodyEditor
            ? window.grpcBodyEditor.getContent()
            : (grpcBodyInput?.value || '{}');

        await this.repository.saveGrpcData(collectionId, endpointId, {
            target: grpcTargetInput?.value || '',
            service: grpcServiceSelect?.value || '',
            fullMethod: grpcMethodSelect?.value || endpoint.path || '',
            requestJson: requestJson || '{}',
            metadata,
            useTls: grpcTlsCheckbox?.checked || false
        });

        endpointLocations.forEach(({ endpoint: currentEndpoint }) => {
            currentEndpoint.path = grpcMethodSelect?.value || currentEndpoint.path;
        });

        await this.repository.save(collections);
        await this.refreshCollections();
    }

    async saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs) {
        const { urlInput, queryParamsList, headersList, bodyInput } = this.getRequestFormElements();

        if (urlInput && urlInput.value) {
            await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
        }

        if (queryParamsList) {
            const queryParams = parseKeyValuePairs(queryParamsList);
            const queryParamsArray = Object.entries(queryParams).map(([key, value]) => ({ key, value }));
            await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParamsArray);
        }

        if (headersList) {
            const headers = parseKeyValuePairs(headersList);
            const headersArray = Object.entries(headers).map(([key, value]) => ({ key, value }));
            await this.repository.savePersistedHeaders(collectionId, endpointId, headersArray);
        }

        if (bodyInput) {
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }

        await this.refreshCollections();
    }

    async saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager) {
        const { urlInput, pathParamsList, queryParamsList, headersList, bodyInput } = this.getRequestFormElements();

        const updates = {};

        if (urlInput && urlInput.value) {
            updates.url = urlInput.value;
        }

        let pathParams = {};
        let queryParams = {};
        let headers = {};

        if (pathParamsList) {
            pathParams = parseKeyValuePairs(pathParamsList);
            updates.pathParams = Object.entries(pathParams).map(([key, value]) => ({ key, value }));
        }

        if (queryParamsList) {
            queryParams = parseKeyValuePairs(queryParamsList);
            updates.queryParams = Object.entries(queryParams).map(([key, value]) => ({ key, value }));
        }

        if (headersList) {
            headers = parseKeyValuePairs(headersList);
            updates.headers = Object.entries(headers).map(([key, value]) => ({ key, value }));
        }

        const bodyState = bodyInput ? this.collectionService.captureRequestBodyState() : null;
        if (bodyState) {
            Object.assign(updates, bodyState);
        }

        const authConfig = authManager.getAuthConfig();
        if (authConfig) {
            updates.authConfig = authConfig;
        }

        if (Object.keys(updates).length > 0) {
            await this.repository.updateEndpointFields(collectionId, endpointId, updates);
        }

        if (urlInput && urlInput.value) {
            await this.updateEndpointPathFromUrl(collectionId, endpointId, urlInput.value);
        }

        await this.syncActiveWorkspaceTab({
            urlInput,
            pathParamsList,
            queryParamsList,
            headersList,
            bodyInput,
            pathParams,
            queryParams,
            headers,
            authConfig
        });
    }

    async updateEndpointPathFromUrl(collectionId, endpointId, url) {
        try {
            const path = this.normalizePath(url);
            const collections = await this.repository.getAll();
            const collection = collections.find(c => c.id === collectionId);

            if (!collection) {
                return;
            }

            const foundLocations = this.findAllEndpointLocations(collection, endpointId);
            if (foundLocations.length === 0) {
                return;
            }

            const pathChanged = foundLocations.some(({ endpoint }) => endpoint.path !== path);
            if (!pathChanged) {
                return;
            }

            foundLocations.forEach(({ endpoint }) => {
                endpoint.path = path;
            });

            await this.repository.save(collections);
            await this.refreshCollections();
        } catch (error) {
            void error;
        }
    }

    async syncActiveWorkspaceTab({
        urlInput,
        pathParamsList,
        queryParamsList,
        headersList,
        bodyInput,
        pathParams,
        queryParams,
        headers,
        authConfig
    }) {
        if (!window.workspaceTabController) {
            return;
        }

        const activeTab = await window.workspaceTabController.getActiveTab();
        if (!activeTab || !activeTab.request) {
            return;
        }

        const updatedRequest = {};
        let hasChanges = false;

        if (urlInput && urlInput.value && activeTab.request.url !== urlInput.value) {
            updatedRequest.url = urlInput.value;
            hasChanges = true;
        }

        if (pathParamsList) {
            updatedRequest.pathParams = pathParams;
            hasChanges = true;
        }

        if (queryParamsList) {
            updatedRequest.queryParams = queryParams;
            hasChanges = true;
        }

        if (headersList) {
            updatedRequest.headers = headers;
            hasChanges = true;
        }

        if (bodyInput) {
            const graphqlBodyManager = window.domElements?.graphqlBodyManager;
            const isGraphQLMode = graphqlBodyManager && graphqlBodyManager.isGraphQLMode();

            if (isGraphQLMode) {
                updatedRequest.body = {
                    mode: 'graphql',
                    query: graphqlBodyManager.getGraphQLQuery(),
                    variables: graphqlBodyManager.getGraphQLVariables()
                };
            } else {
                updatedRequest.body = {
                    mode: 'json',
                    content: getRequestBodyContent()
                };
            }
            hasChanges = true;
        }

        if (authConfig) {
            updatedRequest.authType = authConfig.type || 'none';
            updatedRequest.authConfig = authConfig.config || {};
            hasChanges = true;
        }

        if (!hasChanges) {
            return;
        }

        const activeTabId = await window.workspaceTabController.service.getActiveTabId();
        if (!activeTabId) {
            return;
        }

        await window.workspaceTabController.service.updateTab(activeTabId, {
            request: updatedRequest
        });
    }

    getRequestFormElements() {
        return {
            urlInput: document.getElementById('url-input'),
            pathParamsList: document.getElementById('path-params-list'),
            queryParamsList: document.getElementById('query-params-list'),
            headersList: document.getElementById('headers-list'),
            bodyInput: document.getElementById('body-input')
        };
    }

    normalizePath(url) {
        let path = url.replace(/\{\{baseUrl\}\}/g, '');

        if (path.match(/^https?:\/\//)) {
            const urlObj = new URL(path);
            path = urlObj.pathname;
        } else {
            const queryIndex = path.indexOf('?');
            if (queryIndex !== -1) {
                path = path.substring(0, queryIndex);
            }
        }

        return path;
    }

    findAllEndpointLocations(collection, endpointId) {
        const foundLocations = [];

        const topLevelEndpoint = collection.endpoints?.find(endpoint => endpoint.id === endpointId);
        if (topLevelEndpoint) {
            foundLocations.push({ endpoint: topLevelEndpoint });
        }

        if (collection.folders) {
            for (const folder of collection.folders) {
                if (!folder.endpoints) {
                    continue;
                }
                const folderEndpoint = folder.endpoints.find(endpoint => endpoint.id === endpointId);
                if (folderEndpoint) {
                    foundLocations.push({ endpoint: folderEndpoint });
                }
            }
        }

        return foundLocations;
    }
}
