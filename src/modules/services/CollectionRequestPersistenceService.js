/**
 * @fileoverview Persists collection request edits from the request UI
 * @module services/CollectionRequestPersistenceService
 */

import { app } from '../appContext.js';
import { getRequestBodyContent } from '../requestBodyHelper.js';
import { getProtocol } from '../protocols/protocolRegistry.js';
import { findRequest, updateRequest } from '../collections/collectionTree.js';

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
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId, bodyInput);
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
                sse: () => this.saveSseRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows),
                mqtt: () => this.saveMqttRequest(collectionId, endpointId),
                http: () => this.saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows)
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

    async saveWebSocketRequest(collectionId, endpointId, parseKeyValuePairs, parseKeyValueRows) {
        const { urlInput, queryParamsList, headersList, bodyInput } = this.getRequestFormElements(
            getProtocol('websocket')
        );

        if (urlInput && urlInput.value) {
            await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
        }

        if (queryParamsList) {
            const queryParamsArray = readPersistedRows(queryParamsList, parseKeyValuePairs, parseKeyValueRows);
            await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParamsArray);
        }

        if (headersList) {
            const headersArray = readPersistedRows(headersList, parseKeyValuePairs, parseKeyValueRows);
            await this.repository.savePersistedHeaders(collectionId, endpointId, headersArray);
        }

        if (bodyInput) {
            await this.collectionService.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }
    }

    async saveGraphQLRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows) {
        const { urlInput, headersList } = this.getRequestFormElements(getProtocol('graphql'));
        const { graphqlBodyManager } = app;

        if (urlInput && urlInput.value) {
            await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
        }

        if (headersList) {
            const headersArray = readPersistedRows(headersList, parseKeyValuePairs, parseKeyValueRows);
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
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Function} parseKeyValuePairs
     * @param {Object} authManager
     * @returns {Promise<void>}
     */
    async saveSseRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows) {
        const descriptor = getProtocol('sse');
        const { urlInput, queryParamsList, headersList, bodyInput } = this.getRequestFormElements(descriptor);

        if (urlInput && urlInput.value) {
            await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
        }

        if (queryParamsList) {
            const queryParamsArray = readPersistedRows(queryParamsList, parseKeyValuePairs, parseKeyValueRows);
            await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParamsArray);
        }

        if (headersList) {
            const headersArray = readPersistedRows(headersList, parseKeyValuePairs, parseKeyValueRows);
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
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
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
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} patch
     * @returns {Promise<void>}
     */
    async patchEndpointRecords(collectionId, endpointId, patch) {
        const collection = await this.repository.readForUpdate(collectionId);
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

    async saveHttpRequest(collectionId, endpointId, parseKeyValuePairs, authManager, parseKeyValueRows) {
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
            const collection = await this.repository.readForUpdate(collectionId);

            if (!collection) {
                return;
            }

            const endpoint = findRequest(collection, endpointId);
            if (!endpoint || endpoint.path === path) {
                return;
            }

            await this.repository.saveOne(updateRequest(collection, endpointId, { path }));
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
