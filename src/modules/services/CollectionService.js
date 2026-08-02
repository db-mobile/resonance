/**
 * @fileoverview Service for managing collection business logic and request handling
 * @module services/CollectionService
 */

import { app } from '../appContext.js';
import { flattenRequests, topLevelFolders, findRequest, updateRequest, removeRequest } from '../collections/collectionTree.js';
import {
    getProtocol,
    derivePath,
    deriveMethod,
    deriveHttpMethod
} from '../protocols/protocolRegistry.js';
import { getRequestBodyContent } from '../requestBodyHelper.js';
import { toast } from '../ui/Toast.js';

/**
 * Service for managing API collection business logic
 *
 * @class
 * @classdesc Provides high-level collection operations including CRUD operations,
 * endpoint management, request body generation, and form population. Handles
 * OpenAPI schema processing and coordinates with repository layer for persistence.
 * Manages request state including path parameters, query parameters, headers, and
 * authentication configuration.
 */
export class CollectionService {
    /**
     * Creates a CollectionService instance
     *
     * @param {CollectionRepository} repository - Data access layer for collections
     * @param {SchemaProcessor} schemaProcessor - OpenAPI schema processor
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(repository, schemaProcessor, statusDisplay) {
        this.repository = repository;
        this.schemaProcessor = schemaProcessor;
        this.statusDisplay = statusDisplay;
    }

    /**
     * Loads all collections from storage
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects
     * @throws {Error} If storage access fails
     */
    async loadCollections() {
        try {
            const collections = await this.repository.getAll();
            return collections;
        } catch (error) {
            this.statusDisplay.update('Error loading collections', null);
            throw error;
        }
    }

    /**
     * Imports a collection into storage
     *
     * Updates status display with progress and completion status.
     *
     * @async
     * @param {Object} collection - The collection object to import
     * @param {string} collection.name - Collection name
     * @param {string} [collection.baseUrl] - Base URL for the collection
     * @param {Array<Object>} [collection.endpoints] - Collection endpoints
     * @returns {Promise<Object>} The imported collection with generated ID
     * @throws {Error} If import or storage operation fails
     */
    async importCollection(collection) {
        try {
            this.statusDisplay.update('Importing collection...', null);
            
            const importedCollection = await this.repository.add(collection);
            
            this.statusDisplay.update(`Imported collection: ${collection.name}`, null);
            return importedCollection;
        } catch (error) {
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Renames an existing collection
     *
     * @async
     * @param {string} collectionId - The ID of the collection to rename
     * @param {string} newName - The new name for the collection
     * @returns {Promise<Object>} The updated collection object
     * @throws {Error} If collection is not found or update fails
     */
    async renameCollection(collectionId, newName) {
        try {
            this.statusDisplay.update('Renaming collection...', null);

            const updatedCollection = await this.repository.updateMetadata(collectionId, { name: newName });

            this.statusDisplay.update(`Collection renamed to "${newName}"`, null);
            return updatedCollection;
        } catch (error) {
            this.statusDisplay.update(`Error renaming collection: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Deletes a collection from storage
     *
     * @async
     * @param {string} collectionId - The ID of the collection to delete
     * @returns {Promise<boolean>} True if deletion was successful
     * @throws {Error} If collection is not found or deletion fails
     */
    async deleteCollection(collectionId) {
        await this.repository.delete(collectionId);
        return true;
    }

    /**
     * Opens a collection directory that already exists on disk, in place.
     *
     * Nothing is copied. The directory is registered where it is, so the app
     * treats it as the user's own and never renames or deletes it.
     *
     * @async
     * @param {string} path - The directory the user picked
     * @returns {Promise<Object>} `{ opened, alreadyOpen, failed }`
     * @throws {Error} If nothing there can be opened
     */
    async openExistingCollection(path) {
        try {
            this.statusDisplay.update('Opening collection...', null);

            const result = await this.repository.openExisting(path);

            const count = result.opened.length;
            this.statusDisplay.update(
                count > 0 ? `Opened ${count} collection${count === 1 ? '' : 's'}` : '',
                null
            );
            return result;
        } catch (error) {
            const message = typeof error === 'string' ? error : (error.message || 'Unknown error');
            this.statusDisplay.update('', null);
            throw new Error(message, { cause: error });
        }
    }

    /**
     * Removes a collection from the list, leaving every file on disk.
     *
     * @async
     * @param {string} collectionId - The collection to close
     * @returns {Promise<boolean>} True when it is no longer listed
     */
    async closeCollection(collectionId) {
        await this.repository.close(collectionId);
        return true;
    }

    /**
     * Exports a collection as OpenAPI specification
     *
     * Triggers the export process via IPC to the main process, which handles
     * file dialog and file writing. Updates status display with progress.
     *
     * @async
     * @param {string} collectionId - The ID of the collection to export
     * @param {string} format - Export format ('json' or 'yaml')
     * @returns {Promise<Object>} Result object with success status and file path
     * @throws {Error} If collection is not found or export fails
     */
    async exportCollectionAsOpenApi(collectionId, format) {
        try {
            this.statusDisplay.update('Exporting collection...', null);

            const result = await window.backendAPI.collections.exportOpenApi(collectionId, format);

            if (result.cancelled) {
                this.statusDisplay.update('Export cancelled', null);
                return { success: false, cancelled: true };
            }

            if (result.success) {
                let message = `Collection exported successfully to ${format.toUpperCase()}`;
                if (result.skipped && result.skipped.count > 0) {
                    message = `${message} (${result.skipped.count} items skipped)`;
                }
                this.statusDisplay.update(message, null);
                return result;
            }

            throw new Error('Export failed');
        } catch (error) {
            this.statusDisplay.update(`Export error: ${error.message}`, null);
            throw error;
        }
    }

    async exportCollectionAsPostman(collectionId) {
        try {
            this.statusDisplay.update('Exporting collection...', null);

            const result = await window.backendAPI.collections.exportPostman(collectionId);

            if (result.cancelled) {
                this.statusDisplay.update('Export cancelled', null);
                return { success: false, cancelled: true };
            }

            if (result.success) {
                let message = 'Collection exported successfully to Postman';
                if (result.skipped && result.skipped.count > 0) {
                    message = `${message} (${result.skipped.count} items skipped)`;
                }
                this.statusDisplay.update(message, null);
                return result;
            }

            throw new Error('Export failed');
        } catch (error) {
            this.statusDisplay.update(`Export error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Creates a new empty collection
     *
     * Generates a unique collection ID and initializes default structure.
     *
     * @async
     * @param {string} name - The name for the new collection
     * @returns {Promise<Object>} The newly created collection object
     * @throws {Error} If creation or storage operation fails
     */
    async createCollection(nameOrOptions) {
        try {
            const options = typeof nameOrOptions === 'string'
                ? { name: nameOrOptions }
                : (nameOrOptions || {});
            const name = options.name?.trim();

            if (!name) {
                throw new Error('Collection name is required');
            }

            const newCollection = {
                id: this.generateCollectionId(),
                name,
                baseUrl: '',
                endpoints: [],
                folders: [],
                defaultHeaders: {},
                _openApiSpec: null
            };

            if (options.storageParentPath) {
                newCollection.storageParentPath = options.storageParentPath;
            }

            const createdCollection = await this.repository.add(newCollection);

            toast.success(`Collection "${name}" created`);
            return createdCollection;
        } catch (error) {
            this.statusDisplay.update(`Error creating collection: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Generates a unique collection ID
     *
     * @private
     * @returns {string} A unique collection identifier
     */
    generateCollectionId() {
        return `collection_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Adds a new request to an existing collection
     *
     * Automatically organizes the request into folders based on path structure.
     *
     * @async
     * @param {string} collectionId - The ID of the target collection
     * @param {Object} requestData - The request data
     * @param {string} requestData.name - Request name
     * @param {string} requestData.method - HTTP method (GET, POST, etc.)
     * @param {string} requestData.path - Request path/URL
     * @returns {Promise<Object>} The created endpoint object
     * @throws {Error} If collection is not found or request cannot be added
     */
    async addRequestToCollection(collectionId, requestData) {
        try {
            this.statusDisplay.update('Adding new request...', null);
            
            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

            const descriptor = getProtocol(requestData.protocol);
            const httpMethod = deriveHttpMethod(descriptor, requestData);

            const newEndpoint = {
                id: this.generateEndpointId(collection),
                name: requestData.name,
                protocol: descriptor.id,
                method: deriveMethod(descriptor, requestData),
                path: derivePath(descriptor, requestData),
                description: '',
                parameters: {
                    query: {},
                    header: {},
                    path: {}
                },
                requestBody: null,
                headers: {}
            };

            if (httpMethod) {
                newEndpoint.httpMethod = httpMethod;
            }

            collection.endpoints = collection.endpoints || [];
            collection.endpoints.push(newEndpoint);

            // Auto-foldering only kicks in for a collection that already uses
            // folders, so a flat collection stays flat. Preserved from the
            // original behaviour deliberately.
            if (collection.folders && collection.folders.length > 0) {
                const basePath = this.extractBasePath(
                    descriptor.folderBucket ?? requestData.path
                );

                let targetFolder = topLevelFolders(collection).find(folder => folder.name === basePath);

                if (!targetFolder) {
                    targetFolder = {
                        id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                        name: basePath,
                        endpoints: []
                    };
                    collection.folders.push(targetFolder);
                }

                targetFolder.endpoints = targetFolder.endpoints || [];
                targetFolder.endpoints.push(newEndpoint);
            }

            await this.repository.saveOne(collection);

            await this.persistNewEndpointSidecars(collectionId, newEndpoint.id, descriptor, requestData);

            this.statusDisplay.update(`Added new request: ${requestData.name}`, null);
            return newEndpoint;
        } catch (error) {
            this.statusDisplay.update(`Error adding request: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Writes the per-protocol sidecar data a freshly created endpoint needs.
     *
     * Which writes happen is decided by the protocol descriptor rather than by
     * the protocol id, so a protocol that stores a URL gets one without needing
     * a branch here.
     *
     * @private
     * @param {string} collectionId - The collection identifier
     * @param {string} endpointId - The new endpoint's identifier
     * @param {Object} descriptor - The protocol descriptor
     * @param {Object} requestData - The captured request data
     * @returns {Promise<void>}
     */
    async persistNewEndpointSidecars(collectionId, endpointId, descriptor, requestData) {
        const { createSidecars } = descriptor;

        if (createSidecars.includes('url')) {
            await this.repository.savePersistedUrl(
                collectionId,
                endpointId,
                requestData.url || requestData.broker || requestData.path || ''
            );
        }

        if (createSidecars.includes('grpcData')) {
            await this.repository.saveGrpcData(collectionId, endpointId, {
                target: requestData.target || '',
                service: requestData.service || '',
                fullMethod: requestData.fullMethod || '',
                requestJson: requestData.requestJson || '{}'
            });
        }

        if (createSidecars.includes('graphqlData')) {
            await this.repository.saveGraphQLData(collectionId, endpointId, {
                query: requestData.query || '',
                variables: requestData.variables || '',
                operationName: requestData.operationName || null
            });
        }

        if (createSidecars.includes('mqttData')) {
            await this.repository.saveMqttData(collectionId, endpointId, {
                clientId: requestData.clientId || '',
                username: requestData.username || '',
                subscribeTopic: requestData.subscribeTopic || '',
                publishTopic: requestData.publishTopic || '',
                qos: requestData.qos || 0
            });
        }
    }

    /**
     * Generates a unique endpoint ID within a collection
     *
     * Ids are timestamp-and-random rather than a counter over the existing
     * ones. A counter reuses the id of a deleted request, which would let the
     * new request inherit the old one's keychain credentials, pinned state,
     * scripts and mock overrides, all of which are keyed by endpoint id
     * outside the collection file. It is also a pure function of collection
     * contents, so two people branching from the same commit would mint the
     * same id and their merge would carry two requests claiming it.
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {string} A unique endpoint identifier
     */
    generateEndpointId(collection) {
        const existingIds = new Set(flattenRequests(collection).map(endpoint => endpoint.id));

        let newId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        while (existingIds.has(newId)) {
            newId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }

        return newId;
    }

    /**
     * Extracts the base path segment from a URL path
     *
     * Used for automatic folder organization.
     *
     * @private
     * @param {string} pathKey - The full URL path
     * @returns {string} The first path segment or 'custom'
     */
    extractBasePath(pathKey) {
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');

        return segments[0] || 'custom';
    }

    /**
     * Renames a request in a collection
     *
     * Updates the endpoint name in both the collection's endpoints array
     * and any folders containing the endpoint.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID to rename
     * @param {string} newName - The new name for the request
     * @returns {Promise<Object>} The updated endpoint object
     * @throws {Error} If collection or endpoint is not found or update fails
     */
    async renameRequest(collectionId, endpointId, newName) {
        try {
            this.statusDisplay.update('Renaming request...', null);

            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

            const renamed = updateRequest(collection, endpointId, { name: newName });
            if (!renamed) {
                throw new Error(`Endpoint with id ${endpointId} not found in collection`);
            }

            const updatedEndpoint = findRequest(renamed, endpointId);

            await this.repository.saveOne(renamed);

            this.statusDisplay.update(`Request renamed to "${newName}"`, null);
            return updatedEndpoint;
        } catch (error) {
            this.statusDisplay.update(`Error renaming request: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Deletes a request from a collection
     *
     * Removes the endpoint from the collection and all folders, and cleans up
     * persisted endpoint data (headers, params, body, auth).
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID to delete
     * @returns {Promise<boolean>} True if deletion was successful
     * @throws {Error} If collection is not found or deletion fails
     */
    async deleteRequestFromCollection(collectionId, endpointId) {
        try {
            this.statusDisplay.update('Deleting request...', null);

            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

            // An emptied folder is kept: it is a real directory on disk now, and
            // one a user made deliberately should not vanish when its last
            // request is deleted.
            const reduced = removeRequest(collection, endpointId) ?? collection;

            await this.repository.saveOne(reduced);

            await this.repository.deletePersistedEndpointData(collectionId, endpointId);

            this.statusDisplay.update('Request deleted successfully', null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting request: ${error.message}`, null);
            throw error;
        }
    }

    async saveRequestBodyModification(collectionId, endpointId, _bodyInput) {
        await this.saveModifiedRequestBody(collectionId, endpointId);
    }

    /**
     * Generates request body from OpenAPI schema or examples
     *
     * @param {Object} requestBody - The request body spec from OpenAPI
     * @returns {string} Generated JSON request body
     */
    generateRequestBody(requestBody) {
        if (requestBody.example && requestBody.example !== null && requestBody.example !== 'null') {
            return requestBody.example;
        }

        if (requestBody.schema) {
            const resolvedSchema = this.schemaProcessor.resolveSchemaRefs(requestBody.schema);
            const placeholder = this.schemaProcessor.generateExampleFromSchema(resolvedSchema);

            if (placeholder && placeholder !== 'null' && placeholder !== null && placeholder !== undefined) {
                return placeholder;
            }
        }

        if (requestBody.required) {
            return JSON.stringify({
                'note': 'Request body is required',
                'data': 'Please fill in the required fields'
            }, null, 2);
        }

        return JSON.stringify({ 'data': 'example' }, null, 2);
    }

    captureRequestBodyState() {
        const bodyModeSelect = document.getElementById('body-mode-select');
        const bodyMode = bodyModeSelect?.value || 'json';

        const state = { modifiedBody: null, formBodyData: null, graphqlData: null };

        if (bodyMode === 'formdata' && app.formBodyManager) {
            state.formBodyData = {
                mode: 'formdata',
                fields: app.formBodyManager.getFormDataRows()
            };
        } else if (bodyMode === 'urlencoded' && app.formBodyManager) {
            state.formBodyData = {
                mode: 'urlencoded',
                fields: app.formBodyManager.getUrlencodedRows()
            };
        } else if (bodyMode === 'binary' && app.formBodyManager) {
            state.formBodyData = {
                mode: 'binary',
                ...app.formBodyManager.getBinaryBody()
            };
        } else if (bodyMode === 'text') {
            state.formBodyData = {
                mode: 'text',
                content: app.requestBodyTextEditor
                    ? app.requestBodyTextEditor.getContent()
                    : ''
            };
        } else if (app.graphqlBodyManager && app.graphqlBodyManager.isGraphQLMode()) {
            state.graphqlData = {
                mode: 'graphql',
                query: app.graphqlBodyManager.getGraphQLQuery(),
                variables: app.graphqlBodyManager.getGraphQLVariables()
            };
        } else {
            const currentBody = getRequestBodyContent().trim();
            state.modifiedBody = currentBody || null;
        }

        return state;
    }

    async saveModifiedRequestBody(collectionId, endpointId) {
        try {
            const state = this.captureRequestBodyState();
            await this.repository.saveBodyState(collectionId, endpointId, state);
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves GraphQL mode and content for an endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {string} query - GraphQL query
     * @param {string} variables - GraphQL variables JSON
     * @returns {Promise<void>}
     */
    async saveGraphQLData(collectionId, endpointId, query, variables) {
        try {
            await this.repository.saveGraphQLData(collectionId, endpointId, {
                mode: 'graphql',
                query,
                variables
            });
        } catch (error) {
            void error;
        }
    }

    /**
     * Gets saved GraphQL data for an endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Object|null>} GraphQL data or null if not found
     */
    async getGraphQLData(collectionId, endpointId) {
        try {
            return await this.repository.getGraphQLData(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /**
     * Saves current path parameters to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async saveCurrentPathParams(collectionId, endpointId, formElements) {
        try {
            const pathParams = this.parseKeyValuePairs(formElements.pathParamsList);
            await this.repository.savePersistedPathParams(collectionId, endpointId, pathParams);
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves current query parameters to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async saveCurrentQueryParams(collectionId, endpointId, formElements) {
        try {
            const queryParams = this.parseKeyValuePairs(formElements.queryParamsList);
            await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParams);
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves current headers to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async saveCurrentHeaders(collectionId, endpointId, formElements) {
        try {
            const headers = this.parseKeyValuePairs(formElements.headersList);
            await this.repository.savePersistedHeaders(collectionId, endpointId, headers);
        } catch (error) {
            void error;
        }
    }

    /**
     * Parses key-value pairs from a container element
     *
     * @private
     * @param {HTMLElement} container - Container with key-value rows
     * @returns {Array<Object>} Array of {key, value} objects
     */
    parseKeyValuePairs(container) {
        const pairs = [];
        const rows = container.querySelectorAll('.key-value-row');

        rows.forEach(row => {
            const keyInput = row.querySelector('.key-input');
            const valueInput = row.querySelector('.value-input');

            if (keyInput && valueInput && keyInput.value.trim()) {
                pairs.push({
                    key: keyInput.value.trim(),
                    value: valueInput.value.trim()
                });
            }
        });

        return pairs;
    }

    /**
     * Clears all child elements from a container
     *
     * @private
     * @param {HTMLElement} container - Container to clear
     * @returns {void}
     */
    clearKeyValueList(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

}
