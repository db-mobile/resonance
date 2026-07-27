/**
 * @fileoverview Loads collection endpoints into the workspace or legacy form
 * @module services/CollectionEndpointLoaderService
 */

import { app } from '../appContext.js';
import {
    getProtocol,
    projectPersistedData,
    endpointHttpMethod
} from '../protocols/protocolRegistry.js';

/**
 * Coordinates endpoint hydration for selection and restore flows.
 */
export class CollectionEndpointLoaderService {
    /**
     * @param {Object} options - Loader dependencies
     * @param {CollectionRepository} options.repository - Collection repository
     * @param {CollectionService} options.collectionService - Collection service
     * @param {SchemaProcessor} options.schemaProcessor - Schema processor
     * @param {Function} options.getFormElements - Returns legacy form element references
     * @param {Function} options.setActiveEndpoint - Marks the active endpoint in the renderer
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
            if (app.workspaceTabController) {
                await this.loadEndpointIntoWorkspaceTab(collection, endpoint);
            } else {
                const formElements = this.getFormElements();
                await this.collectionService.loadEndpointIntoForm(collection, endpoint, formElements);
            }

            await this.repository.saveLastSelectedRequest(collection.id, endpoint.id);
            this.setActiveEndpoint?.(collection.id, endpoint.id);
        } catch (error) {
            void error;
        }
    }

    async restoreLastSelectedRequest() {
        try {
            const lastSelected = await this.repository.getLastSelectedRequest();

            if (!lastSelected || !lastSelected.collectionId || !lastSelected.endpointId) {
                return;
            }

            const collection = await this.repository.getById(lastSelected.collectionId);
            if (!collection) {
                await this.repository.clearLastSelectedRequest();
                return;
            }

            const endpoint = this.findEndpointInCollection(collection, lastSelected.endpointId);
            if (!endpoint) {
                await this.repository.clearLastSelectedRequest();
                return;
            }

            const formElements = this.getFormElements();
            await this.collectionService.loadEndpointIntoForm(collection, endpoint, formElements);
            this.setActiveEndpoint?.(collection.id, endpoint.id);
        } catch (error) {
            void error;
        }
    }

    async loadEndpointIntoWorkspaceTab(collection, endpoint) {
        this.schemaProcessor.setOpenApiSpec(collection._openApiSpec);

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

    findEndpointInCollection(collection, endpointId) {
        if (collection.endpoints) {
            const endpoint = collection.endpoints.find(current => current.id === endpointId);
            if (endpoint) {
                return endpoint;
            }
        }

        if (collection.folders) {
            for (const folder of collection.folders) {
                if (!folder.endpoints) {
                    continue;
                }
                const endpoint = folder.endpoints.find(current => current.id === endpointId);
                if (endpoint) {
                    return endpoint;
                }
            }
        }

        return null;
    }
}
