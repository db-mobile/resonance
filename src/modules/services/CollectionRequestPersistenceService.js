/**
 * @fileoverview Persists collection request edits from the request UI
 * @module services/CollectionRequestPersistenceService
 */

import { app } from '../appContext.js';
import { getRequestBodyContent } from '../requestBodyHelper.js';
import { getProtocol } from '../protocols/protocolRegistry.js';

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
            const descriptor = getProtocol(endpoint?.protocol);

            const savers = {
                grpc: () => this.saveGrpcRequest(collectionId, endpointId, endpoint, endpointLocations, collections),
                websocket: () => this.saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs),
                graphql: () => this.saveGraphQLRequest(collectionId, endpointId, parseKeyValuePairs, authManager),
                sse: () => this.saveSseRequest(collectionId, endpointId, parseKeyValuePairs, authManager),
                mqtt: () => this.saveMqttRequest(collectionId, endpointId),
                http: () => this.saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager)
            };

            await (savers[descriptor.builder] || savers.http)();
        } catch (error) {
            this.statusDisplay.update(`Error saving request: ${error.message}`, null);
            throw error;
        }
    }

    async saveGrpcRequest(collectionId, endpointId, endpoint, endpointLocations, collections) {
        const grpcState = app.captureGrpcState ? app.captureGrpcState() : {};

        await this.repository.saveGrpcData(collectionId, endpointId, {
            ...grpcState,
            fullMethod: grpcState.fullMethod || endpoint.path || ''
        });

        endpointLocations.forEach(({ endpoint: currentEndpoint }) => {
            currentEndpoint.path = grpcState.fullMethod || currentEndpoint.path;
        });

        await this.repository.save(collections);
        await this.refreshCollections();
    }

    async saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs) {
        const { urlInput, queryParamsList, headersList, bodyInput } = this.getRequestFormElements(
            getProtocol('websocket')
        );

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

    async saveGraphQLRequest(collectionId, endpointId, parseKeyValuePairs, authManager) {
        const { urlInput, headersList } = this.getRequestFormElements(getProtocol('graphql'));
        const { graphqlBodyManager } = app;

        if (urlInput && urlInput.value) {
            await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
        }

        if (headersList) {
            const headers = parseKeyValuePairs(headersList);
            const headersArray = Object.entries(headers).map(([key, value]) => ({ key, value }));
            await this.repository.savePersistedHeaders(collectionId, endpointId, headersArray);
        }

        const authConfig = authManager.getAuthConfig();
        if (authConfig) {
            await this.repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
        }

        if (graphqlBodyManager) {
            await this.repository.saveGraphQLData(collectionId, endpointId, {
                query: graphqlBodyManager.getGraphQLQuery(),
                variables: graphqlBodyManager.getGraphQLVariables(),
                operationName: graphqlBodyManager.getSelectedOperationName?.() || null
            });
        }

        await this.refreshCollections();
    }

    /**
     * Persists edits to an SSE endpoint.
     *
     * Unlike the HTTP saver this never rewrites `endpoint.path`: an SSE endpoint
     * is identified by its absolute URL, which `normalizePath` would truncate to
     * a bare pathname. The chosen HTTP verb is written back to the endpoint
     * records, since the tree badge holds the protocol label instead.
     *
     * @param {string} collectionId - The collection identifier
     * @param {string} endpointId - The endpoint identifier
     * @param {Function} parseKeyValuePairs - Key-value list parser
     * @param {Object} authManager - Authentication manager
     * @returns {Promise<void>}
     */
    async saveSseRequest(collectionId, endpointId, parseKeyValuePairs, authManager) {
        const descriptor = getProtocol('sse');
        const { urlInput, queryParamsList, headersList, bodyInput } = this.getRequestFormElements(descriptor);

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

        const authConfig = authManager.getAuthConfig();
        if (authConfig) {
            await this.repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
        }

        if (bodyInput) {
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }

        const methodSelect = document.getElementById('method-select');
        if (methodSelect && methodSelect.value) {
            await this.patchEndpointRecords(collectionId, endpointId, { httpMethod: methodSelect.value });
        }

        await this.refreshCollections();
    }

    /**
     * Persists edits to an MQTT endpoint.
     *
     * The broker password is deliberately not stored: it is a credential, and
     * the MQTT sidecar record is plain stored data with no secret splitting.
     *
     * @param {string} collectionId - The collection identifier
     * @param {string} endpointId - The endpoint identifier
     * @returns {Promise<void>}
     */
    async saveMqttRequest(collectionId, endpointId) {
        const descriptor = getProtocol('mqtt');
        const { urlInput, bodyInput } = this.getRequestFormElements(descriptor);

        if (urlInput && urlInput.value) {
            await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
        }

        await this.repository.saveMqttData(collectionId, endpointId, {
            clientId: document.getElementById('mqtt-client-id-input')?.value || '',
            username: document.getElementById('mqtt-username-input')?.value || '',
            subscribeTopic: document.getElementById('mqtt-subscribe-input')?.value || '',
            publishTopic: document.getElementById('mqtt-topic-input')?.value || '',
            qos: Number(document.getElementById('mqtt-qos-select')?.value) || 0
        });

        if (bodyInput) {
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }

        await this.refreshCollections();
    }

    /**
     * Applies a patch to every stored copy of an endpoint.
     *
     * An endpoint can appear both at the collection root and inside a folder, so
     * all locations found are updated together.
     *
     * @param {string} collectionId - The collection identifier
     * @param {string} endpointId - The endpoint identifier
     * @param {Object} patch - Fields to merge into the endpoint records
     * @returns {Promise<void>}
     */
    async patchEndpointRecords(collectionId, endpointId, patch) {
        const collections = await this.repository.getAll();
        const collection = collections.find(c => c.id === collectionId);
        if (!collection) {
            return;
        }

        const locations = this.findAllEndpointLocations(collection, endpointId);
        if (locations.length === 0) {
            return;
        }

        const changed = locations.some(({ endpoint }) =>
            Object.entries(patch).some(([key, value]) => endpoint[key] !== value)
        );

        if (!changed) {
            return;
        }

        locations.forEach(({ endpoint }) => {
            Object.assign(endpoint, patch);
        });

        await this.repository.save(collections);
    }

    async saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager) {
        const descriptor = getProtocol('http');
        const { urlInput, pathParamsList, queryParamsList, headersList, bodyInput } =
            this.getRequestFormElements(descriptor);

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

        if (Object.keys(updates).length > 0) {
            await this.repository.updateEndpointFields(collectionId, endpointId, updates);
        }

        const authConfig = authManager.getAuthConfig();
        if (authConfig) {
            await this.repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
        }

        if (descriptor.rewritePathFromUrl && urlInput && urlInput.value) {
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
        if (!app.workspaceTabController) {
            return;
        }

        const activeTab = await app.workspaceTabController.getActiveTab();
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
            const bodyMode = document.getElementById('body-mode-select')?.value || 'json';
            if (bodyMode === 'formdata' && app.formBodyManager) {
                updatedRequest.body = {
                    mode: 'formdata',
                    fields: app.formBodyManager.getFormDataRows()
                };
            } else if (bodyMode === 'urlencoded' && app.formBodyManager) {
                updatedRequest.body = {
                    mode: 'urlencoded',
                    fields: app.formBodyManager.getUrlencodedRows()
                };
            } else if (bodyMode === 'binary' && app.formBodyManager) {
                updatedRequest.body = {
                    mode: 'binary',
                    ...app.formBodyManager.getBinaryBody()
                };
            } else if (bodyMode === 'text') {
                updatedRequest.body = {
                    mode: 'text',
                    content: app.requestBodyTextEditor
                        ? app.requestBodyTextEditor.getContent()
                        : ''
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

        const activeTabId = await app.workspaceTabController.service.getActiveTabId();
        if (!activeTabId) {
            return;
        }

        await app.workspaceTabController.service.updateTab(activeTabId, {
            request: updatedRequest
        });
    }

    /**
     * Resolves the request form inputs for a protocol.
     *
     * Each protocol owns its own URL field, so the descriptor decides which one
     * is read. The shared `url-input` is the fallback for when a protocol's own
     * bar has not been rendered.
     *
     * @param {Object} [descriptor] - The protocol descriptor
     * @returns {Object} Form element references
     */
    getRequestFormElements(descriptor = getProtocol('http')) {
        const ownUrlInput = descriptor.urlInputId
            ? document.getElementById(descriptor.urlInputId)
            : null;

        return {
            urlInput: ownUrlInput || document.getElementById('url-input'),
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
