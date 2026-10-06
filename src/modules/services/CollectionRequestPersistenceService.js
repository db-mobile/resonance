/**
 * @fileoverview Persists collection request edits from the request UI
 * @module services/CollectionRequestPersistenceService
 */

import { app } from '../appContext.js';
import { captureFormBody, getRequestBodyContent } from '../requestBodyHelper.js';
import { getProtocol } from '../protocols/protocolRegistry.js';
import { findRequest, updateRequest } from '../collections/collectionTree.js';
import { readMqttForm } from '../mqtt/mqttFields.js';

/**
 * @param {HTMLElement} list
 * @param {Function} parseKeyValuePairs
 * @param {Function} [parseKeyValueRows]
 * @returns {Array<Object>}
 */
function readPersistedRows(list, parseKeyValuePairs, parseKeyValueRows) {
    if (parseKeyValueRows) {
        return parseKeyValueRows(list);
    }

    return Object.entries(parseKeyValuePairs(list)).map(([key, value]) => ({ key, value }));
}

export class CollectionRequestPersistenceService {
    /**
     * @param {Object} options
     * @param {CollectionRepository} options.repository
     * @param {CollectionService} options.collectionService
     * @param {IStatusDisplay} options.statusDisplay
     * @param {Function} options.refreshCollections
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
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId);
        }
    }

    async saveAllRequestModifications(collectionId, endpointId) {
        try {
            const { parseKeyValuePairs, parseKeyValueRows } = await import('../keyValueManager.js');
            const { authManager } = await import('../authManager.js');

            const collection = await this.repository.readForUpdate(collectionId);
            if (!collection) {
                return;
            }

            const endpoint = findRequest(collection, endpointId);
            const descriptor = getProtocol(endpoint?.protocol);

            const savers = {
                grpc: () => this.saveGrpcRequest(collectionId, endpointId, endpoint, collection),
                websocket: () => this.saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs, parseKeyValueRows),
                graphql: () => this.saveGraphQLRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows),
                sse: () => this.saveSseRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows, collection),
                mqtt: () => this.saveMqttRequest(collectionId, endpointId),
                http: () => this.saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows, collection)
            };

            await (savers[descriptor.builder] || savers.http)();
        } catch (error) {
            this.statusDisplay.update(`Error saving request: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} endpoint
     * @param {Object} collection
     * @returns {Promise<void>}
     */
    async saveGrpcRequest(collectionId, endpointId, endpoint, collection) {
        const grpcState = app.captureGrpcState ? app.captureGrpcState() : {};

        await this.repository.saveGrpcData(collectionId, endpointId, {
            ...grpcState,
            fullMethod: grpcState.fullMethod || endpoint.path || ''
        });

        const path = grpcState.fullMethod || endpoint.path;
        if (path !== endpoint.path) {
            await this.repository.saveOne(updateRequest(collection, endpointId, { path }) ?? collection);
            await this.refreshCollections();
        }
    }

    /**
     * @param {Object} elements
     * @param {Object} parsers
     * @param {Object|null} [authManager]
     * @returns {Object}
     */
    collectSidecarUpdates({ urlInput, queryParamsList, headersList, bodyInput }, { parseKeyValuePairs, parseKeyValueRows }, authManager = null) {
        const updates = {};

        if (urlInput && urlInput.value) {
            updates.url = urlInput.value;
        }

        if (queryParamsList) {
            updates.queryParams = readPersistedRows(queryParamsList, parseKeyValuePairs, parseKeyValueRows);
        }

        if (headersList) {
            updates.headers = readPersistedRows(headersList, parseKeyValuePairs, parseKeyValueRows);
        }

        const authConfig = authManager?.getAuthConfig();
        if (authConfig) {
            updates.authConfig = authConfig;
        }

        const bodyState = bodyInput ? this.collectionService.captureRequestBodyState() : null;
        if (bodyState) {
            Object.assign(updates, bodyState);
        }

        return updates;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} updates
     * @returns {Promise<void>}
     */
    async writeSidecarUpdates(collectionId, endpointId, updates) {
        if (Object.keys(updates).length > 0) {
            await this.repository.updateEndpointFields(collectionId, endpointId, updates);
        }
    }

    async saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs, parseKeyValueRows) {
        const elements = this.getRequestFormElements(getProtocol('websocket'));
        await this.writeSidecarUpdates(collectionId, endpointId,
            this.collectSidecarUpdates(elements, { parseKeyValuePairs, parseKeyValueRows }));
    }

    async saveGraphQLRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows) {
        const { urlInput, headersList } = this.getRequestFormElements(getProtocol('graphql'));
        const { graphqlBodyManager } = app;

        const updates = this.collectSidecarUpdates({ urlInput, headersList }, { parseKeyValuePairs, parseKeyValueRows }, authManager);
        if (graphqlBodyManager) {
            updates.graphqlData = {
                query: graphqlBodyManager.getGraphQLQuery(),
                variables: graphqlBodyManager.getGraphQLVariables(),
                operationName: graphqlBodyManager.getSelectedOperationName?.() || null
            };
        }
        await this.writeSidecarUpdates(collectionId, endpointId, updates);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Function} parseKeyValuePairs
     * @param {Object} authManager
     * @returns {Promise<void>}
     */
    async saveSseRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows, collection = null) {
        const elements = this.getRequestFormElements(getProtocol('sse'));
        await this.writeSidecarUpdates(collectionId, endpointId,
            this.collectSidecarUpdates(elements, { parseKeyValuePairs, parseKeyValueRows }, authManager));

        const methodSelect = document.getElementById('method-select');
        if (methodSelect && methodSelect.value) {
            await this.patchEndpointRecords(collectionId, endpointId, { httpMethod: methodSelect.value }, collection);
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveMqttRequest(collectionId, endpointId) {
        const descriptor = getProtocol('mqtt');
        const { urlInput, bodyInput } = this.getRequestFormElements(descriptor);

        await this.writeSidecarUpdates(collectionId, endpointId,
            this.collectSidecarUpdates({ urlInput, bodyInput }, {}));

        await this.repository.saveMqttData(collectionId, endpointId, readMqttForm());
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} patch
     * @param {Object|null} [loaded]
     * @returns {Promise<void>}
     */
    async patchEndpointRecords(collectionId, endpointId, patch, loaded = null) {
        const collection = loaded ?? await this.repository.readForUpdate(collectionId);
        if (!collection) {
            return;
        }

        const endpoint = findRequest(collection, endpointId);
        if (!endpoint) {
            return;
        }

        const changed = Object.entries(patch).some(([key, value]) => endpoint[key] !== value);
        if (!changed) {
            return;
        }

        await this.repository.saveOne(updateRequest(collection, endpointId, patch));
    }

    async saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows, collection = null) {
        const descriptor = getProtocol('http');
        const { urlInput, pathParamsList, queryParamsList, headersList, bodyInput } =
            this.getRequestFormElements(descriptor);

        const updates = {};

        if (urlInput && urlInput.value) {
            updates.url = urlInput.value;
        }

        let pathParams = {};
        let queryParams = [];
        let headers = [];

        if (pathParamsList) {
            pathParams = parseKeyValuePairs(pathParamsList);
            updates.pathParams = Object.entries(pathParams).map(([key, value]) => ({ key, value }));
        }

        if (queryParamsList) {
            queryParams = readPersistedRows(queryParamsList, parseKeyValuePairs, parseKeyValueRows);
            updates.queryParams = queryParams;
        }

        if (headersList) {
            headers = readPersistedRows(headersList, parseKeyValuePairs, parseKeyValueRows);
            updates.headers = headers;
        }

        const bodyState = bodyInput ? this.collectionService.captureRequestBodyState() : null;
        if (bodyState) {
            Object.assign(updates, bodyState);
        }

        const authConfig = authManager.getAuthConfig();
        if (authConfig) {
            updates.authConfig = authConfig;
        }

        await this.writeSidecarUpdates(collectionId, endpointId, updates);

        if (descriptor.rewritePathFromUrl && urlInput && urlInput.value) {
            await this.updateEndpointPathFromUrl(collectionId, endpointId, urlInput.value, collection);
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

    async updateEndpointPathFromUrl(collectionId, endpointId, url, loaded = null) {
        try {
            const path = this.normalizePath(url);
            const collection = loaded ?? await this.repository.readForUpdate(collectionId);

            if (!collection) {
                return;
            }

            const endpoint = findRequest(collection, endpointId);
            if (!endpoint || endpoint.path === path) {
                return;
            }

            await this.repository.saveOne(updateRequest(collection, endpointId, { path }));
            await this.refreshCollections();
        } catch {
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
            updatedRequest.body = captureFormBody(bodyMode) ?? {
                mode: 'json',
                content: getRequestBodyContent()
            };
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
     * @param {Object} [descriptor]
     * @returns {Object}
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

}
