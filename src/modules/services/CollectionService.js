/**
 * @fileoverview Service for managing collection business logic and request handling
 * @module services/CollectionService
 */

import { app } from '../appContext.js';
import { flattenRequests, topLevelFolders, walkFolders, findRequest, updateRequest, removeRequest } from '../collections/collectionTree.js';
import {
    getProtocol,
    derivePath,
    deriveMethod,
    deriveHttpMethod
} from '../protocols/protocolRegistry.js';
import { getRequestBodyContent } from '../requestBodyHelper.js';
import { toast } from '../ui/Toast.js';

export class CollectionService {
    /**
     * @param {CollectionRepository} repository
     * @param {SchemaProcessor} schemaProcessor
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(repository, schemaProcessor, statusDisplay) {
        this.repository = repository;
        this.schemaProcessor = schemaProcessor;
        this.statusDisplay = statusDisplay;
    }

    /** @returns {Promise<Array<Object>>} */
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
     * @param {Object} collection
     * @param {string} collection.name
     * @param {string} [collection.baseUrl]
     * @param {Array<Object>} [collection.endpoints]
     * @returns {Promise<Object>}
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
     * @param {string} collectionId
     * @param {string} newName
     * @returns {Promise<Object>}
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
     * @param {string} collectionId
     * @returns {Promise<boolean>}
     */
    async deleteCollection(collectionId) {
        await this.repository.delete(collectionId);
        return true;
    }

    /**
     * @param {string} path
     * @returns {Promise<Object>}
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
     * @param {string} collectionId
     * @returns {Promise<boolean>}
     */
    async closeCollection(collectionId) {
        await this.repository.close(collectionId);
        return true;
    }

    /**
     * @param {string} collectionId
     * @param {string} format
     * @returns {Promise<Object>}
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
     * @param {string} name
     * @returns {Promise<Object>}
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

    /** @returns {string} */
    generateCollectionId() {
        return `collection_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * @param {string} collectionId
     * @param {Object} requestData
     * @param {string} requestData.name
     * @param {string} requestData.method
     * @param {string} requestData.path
     * @returns {Promise<Object>}
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

            if (collection.folders && collection.folders.length > 0) {
                const basePath = this.extractBasePath(
                    descriptor.folderBucket ?? requestData.path
                );

                let targetFolder = topLevelFolders(collection).find(folder => folder.name === basePath);

                if (!targetFolder) {
                    targetFolder = {
                        id: this._uniqueFolderId(basePath, collection),
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} descriptor
     * @param {Object} requestData
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
     * @param {Object} collection
     * @returns {string}
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
     * @param {string} pathKey
     * @returns {string}
     */
    extractBasePath(pathKey) {
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');

        return segments[0] || 'custom';
    }

    /**
     * @param {string} name
     * @param {Object} collection
     * @returns {string}
     */
    _uniqueFolderId(name, collection) {
        const usedIds = new Set();
        for (const folder of walkFolders(collection)) {
            if (folder.id) {
                usedIds.add(folder.id);
            }
        }

        const base = `folder_${name}`.replace(/[^\p{L}\p{N}]/gu, '_');
        let candidate = base;
        let counter = 2;
        while (usedIds.has(candidate)) {
            candidate = `${base}_${counter}`;
            counter += 1;
        }
        return candidate;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} newName
     * @returns {Promise<Object>}
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<boolean>}
     */
    async deleteRequestFromCollection(collectionId, endpointId) {
        try {
            this.statusDisplay.update('Deleting request...', null);

            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

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
     * @param {Object} requestBody
     * @returns {string}
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} query
     * @param {string} variables
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getGraphQLData(collectionId, endpointId) {
        try {
            return await this.repository.getGraphQLData(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
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
     * @param {HTMLElement} container
     * @returns {Array<Object>}
     */
    parseKeyValuePairs(container) {
        const pairs = [];
        const rows = container.querySelectorAll('.key-value-row');

        rows.forEach(row => {
            const keyInput = row.querySelector('.key-input');
            const valueInput = row.querySelector('.value-input');

            if (keyInput && valueInput && keyInput.value.trim()) {
                const pair = {
                    key: keyInput.value.trim(),
                    value: valueInput.value.trim()
                };

                const enabledCheckbox = row.querySelector('.row-enabled-checkbox');
                if (enabledCheckbox) {
                    pair.enabled = enabledCheckbox.checked;
                }

                pairs.push(pair);
            }
        });

        return pairs;
    }

    /**
     * @param {HTMLElement} container
     * @returns {void}
     */
    clearKeyValueList(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

}
