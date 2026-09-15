/**
 * @fileoverview Loads collection endpoints into the workspace or legacy form
 * @module services/CollectionEndpointLoaderService
 */

import { app } from '../appContext.js';
import { findRequest } from '../collections/collectionTree.js';
import {
    getProtocol,
    projectPersistedData,
    endpointHttpMethod
} from '../protocols/protocolRegistry.js';

export class CollectionEndpointLoaderService {
    /**
     * @param {Object} options
     * @param {CollectionRepository} options.repository
     * @param {CollectionService} options.collectionService
     * @param {SchemaProcessor} options.schemaProcessor
     * @param {Function} options.getFormElements
     * @param {Function} options.setActiveEndpoint
     */
    constructor({ repository, collectionService, schemaProcessor, getFormElements, setActiveEndpoint }) {
        this.repository = repository;
        this.collectionService = collectionService;
        this.schemaProcessor = schemaProcessor;
        this.getFormElements = getFormElements;
        this.setActiveEndpoint = setActiveEndpoint;
    }

    async handleEndpointClick(collection, endpoint) {
        try {
            await this.loadEndpointIntoWorkspaceTab(collection, endpoint);

            await this.repository.saveLastSelectedRequest(collection.id, endpoint.id);
            this.setActiveEndpoint?.(collection.id, endpoint.id);
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {Object} collection
     * @returns {Promise<Object|null>}
     */
    async resolveOpenApiSpec(collection) {
        if (collection._openApiSpec) {
            return collection._openApiSpec;
        }

        const full = await this.repository.getById(collection.id);
        return full?._openApiSpec || null;
    }

    async loadEndpointIntoWorkspaceTab(collection, endpoint) {
        this.schemaProcessor.setOpenApiSpec(await this.resolveOpenApiSpec(collection));

        let requestBodyString = '';
        if (endpoint.requestBody) {
            requestBodyString = this.collectionService.generateRequestBody(endpoint.requestBody);
        }

        const descriptor = getProtocol(endpoint.protocol);
        const persistedData = await this.repository.getAllPersistedEndpointData(collection.id, endpoint.id);
        const allowed = projectPersistedData(descriptor, persistedData);

        const endpointData = {
            ...endpoint,
            collectionId: collection.id,
            protocol: descriptor.id,
            collectionBaseUrl: collection.baseUrl,
            collectionDefaultHeaders: collection.defaultHeaders,
            path: endpoint.path,
            method: endpointHttpMethod(endpoint),
            requestBodyString,
            persistedUrl: allowed.url,
            persistedAuthConfig: allowed.authConfig,
            persistedPathParams: allowed.pathParams,
            persistedQueryParams: allowed.queryParams,
            persistedHeaders: allowed.headers,
            persistedBody: allowed.modifiedBody,
            persistedFormBodyData: allowed.formBodyData,
            persistedGraphQLData: allowed.graphqlData,
            persistedMqttData: allowed.mqttData,
            grpcData: allowed.grpcData
        };

        await app.workspaceTabController.loadEndpoint(endpointData, false);
    }

    /**
     * @param {Object} collection
     * @param {string} endpointId
     * @returns {Object|null}
     */
    findEndpointInCollection(collection, endpointId) {
        return findRequest(collection, endpointId);
    }
}
