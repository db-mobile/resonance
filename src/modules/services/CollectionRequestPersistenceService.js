/**
 * @fileoverview Persists what the request editor shows into the endpoint's sidecar records, one saver per protocol
 * @module services/CollectionRequestPersistenceService
 */

import { app } from '../appContext.js';
import { getProtocol } from '../protocols/protocolRegistry.js';
import { findRequest, updateRequest } from '../collections/collectionTree.js';

export class CollectionRequestPersistenceService {
    /**
     * @param {Object} deps
     * @param {Object} deps.repository
     * @param {Object} deps.collectionService
     * @param {Object} deps.statusDisplay
     * @param {Function} deps.refreshCollections
     * @param {import('../requestFormReader.js').RequestFormReader} deps.formReader
     */
    constructor({ repository, collectionService, statusDisplay, refreshCollections, formReader }) {
        this.repository = repository;
        this.collectionService = collectionService;
        this.statusDisplay = statusDisplay;
        this.refreshCollections = refreshCollections;
        this.formReader = formReader;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveRequestBodyModification(collectionId, endpointId) {
        if (this.formReader.hasBody()) {
            await this.collectionService.saveBodyState(collectionId, endpointId, this.formReader.readBodyState());
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveAllRequestModifications(collectionId, endpointId) {
        try {
            const collection = await this.repository.readForUpdate(collectionId);
            if (!collection) {
                return;
            }
            const endpoint = findRequest(collection, endpointId);
            const descriptor = getProtocol(endpoint?.protocol);
            const savers = {
                grpc: () => this.saveGrpcRequest(collectionId, endpointId, endpoint, collection),
                websocket: () => this.saveWebSocketRequest(collectionId, endpointId),
                graphql: () => this.saveGraphQLRequest(collectionId, endpointId),
                sse: () => this.saveSseRequest(collectionId, endpointId, collection),
                mqtt: () => this.saveMqttRequest(collectionId, endpointId),
                http: () => this.saveHttpRequest(collectionId, endpointId, collection)
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
        const grpcState = this.formReader.readGrpcState();
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
     * @param {{url?: string|null, queryParams?: Array<Object>|null, headers?: Array<Object>|null, bodyState?: Object|null, authConfig?: Object|null}} fields
     * @returns {Object}
     */
    collectSidecarUpdates({ url = null, queryParams = null, headers = null, bodyState = null, authConfig = null }) {
        const updates = {};
        if (url) {
            updates.url = url;
        }
        if (queryParams !== null) {
            updates.queryParams = queryParams;
        }
        if (headers !== null) {
            updates.headers = headers;
        }
        if (authConfig) {
            updates.authConfig = authConfig;
        }
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

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveWebSocketRequest(collectionId, endpointId) {
        const form = this.formReader.read(getProtocol('websocket'));
        const updates = this.collectSidecarUpdates({
            url: form.url, queryParams: form.queryParams, headers: form.headers, bodyState: form.bodyState
        });
        updates.websocketData = this.formReader.readWebSocketData();
        await this.writeSidecarUpdates(collectionId, endpointId, updates);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveGraphQLRequest(collectionId, endpointId) {
        const form = this.formReader.read(getProtocol('graphql'));
        const updates = this.collectSidecarUpdates({ url: form.url, headers: form.headers, authConfig: form.authConfig });
        const graphqlData = this.formReader.readGraphQLData();
        if (graphqlData) {
            updates.graphqlData = graphqlData;
        }
        await this.writeSidecarUpdates(collectionId, endpointId, updates);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object|null} [collection]
     * @returns {Promise<void>}
     */
    async saveSseRequest(collectionId, endpointId, collection = null) {
        const form = this.formReader.read(getProtocol('sse'));
        await this.writeSidecarUpdates(collectionId, endpointId, this.collectSidecarUpdates({
            url: form.url, queryParams: form.queryParams, headers: form.headers, bodyState: form.bodyState, authConfig: form.authConfig
        }));
        if (form.method) {
            await this.patchEndpointRecords(collectionId, endpointId, { httpMethod: form.method }, collection);
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveMqttRequest(collectionId, endpointId) {
        const form = this.formReader.read(getProtocol('mqtt'));
        await this.writeSidecarUpdates(collectionId, endpointId, this.collectSidecarUpdates({ url: form.url, bodyState: form.bodyState }));
        await this.repository.saveMqttData(collectionId, endpointId, this.formReader.readMqttData());
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object|null} [collection]
     * @returns {Promise<void>}
     */
    async saveHttpRequest(collectionId, endpointId, collection = null) {
        const descriptor = getProtocol('http');
        const form = this.formReader.read(descriptor);
        const updates = {};

        if (form.url) {
            updates.url = form.url;
        }

        let pathParams = {};
        let queryParams = [];
        let headers = [];

        if (form.pathParams !== null) {
            ({ pathParams } = form);
            updates.pathParams = Object.entries(pathParams).map(([key, value]) => ({ key, value }));
        }
        if (form.queryParams !== null) {
            ({ queryParams } = form);
            updates.queryParams = queryParams;
        }
        if (form.headers !== null) {
            ({ headers } = form);
            updates.headers = headers;
        }
        if (form.bodyState) {
            Object.assign(updates, form.bodyState);
        }
        const { authConfig } = form;
        if (authConfig) {
            updates.authConfig = authConfig;
        }

        await this.writeSidecarUpdates(collectionId, endpointId, updates);

        if (descriptor.rewritePathFromUrl && form.url) {
            await this.updateEndpointPathFromUrl(collectionId, endpointId, form.url, collection);
        }

        await this.syncActiveWorkspaceTab(form, { pathParams, queryParams, headers, authConfig });
    }

    /**
     * @param {import('../requestFormReader.js').RequestFormSnapshot} form
     * @param {{pathParams: Object, queryParams: Array<Object>, headers: Array<Object>, authConfig: Object|null}} data
     * @returns {Promise<void>}
     */
    async syncActiveWorkspaceTab(form, { pathParams, queryParams, headers, authConfig }) {
        if (!app.workspaceTabController) {
            return;
        }
        const activeTab = await app.workspaceTabController.getActiveTab();
        if (!activeTab || !activeTab.request) {
            return;
        }

        const updatedRequest = {};
        let hasChanges = false;

        if (form.url && activeTab.request.url !== form.url) {
            updatedRequest.url = form.url;
            hasChanges = true;
        }
        if (form.pathParams !== null) {
            updatedRequest.pathParams = pathParams;
            hasChanges = true;
        }
        if (form.queryParams !== null) {
            updatedRequest.queryParams = queryParams;
            hasChanges = true;
        }
        if (form.headers !== null) {
            updatedRequest.headers = headers;
            hasChanges = true;
        }
        if (form.bodyState !== null) {
            updatedRequest.body = this.formReader.readTabBody();
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

        await app.workspaceTabController.updateActiveTabRequest(updatedRequest);
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
