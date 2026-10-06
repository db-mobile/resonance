/**
 * @fileoverview Service for managing collection business logic and request handling
 * @module services/CollectionService
 */

import { app } from '../appContext.js';
import {
    flattenRequests,
    topLevelFolders,
    walkFolders,
    findRequest,
    findFolder,
    folderChainForRequest,
    updateRequest,
    updateFolder,
    removeRequest,
    insertRequest,
    insertFolder,
    moveRequest
} from '../collections/collectionTree.js';
import {
    getProtocol,
    derivePath,
    deriveMethod,
    deriveHttpMethod
} from '../protocols/protocolRegistry.js';
import { captureFormBody, getRequestBodyContent } from '../requestBodyHelper.js';
import { toast } from '../ui/Toast.js';
import { generateId } from '../utils/ids.js';
import { normalizeMqttData } from '../mqtt/mqttFields.js';

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

    /**
     * @param {string} label
     * @param {function(): Promise<*>} work
     * @returns {Promise<*>}
     */
    async _reporting(label, work) {
        try {
            return await work();
        } catch (error) {
            this.statusDisplay.update(`${label}: ${error.message}`, null);
            throw error;
        }
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
     * @param {string} collectionId
     * @param {string} newName
     * @returns {Promise<Object>}
     */
    async renameCollection(collectionId, newName) {
        return this._reporting('Error renaming collection', async () => {
            this.statusDisplay.update('Renaming collection...', null);

            const updatedCollection = await this.repository.updateMetadata(collectionId, { name: newName });

            this.statusDisplay.update(`Collection renamed to "${newName}"`, null);
            return updatedCollection;
        });
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

            const outcome = await this.repository.openExisting(path);

            const count = outcome.opened.length;
            this.statusDisplay.update(
                count > 0 ? `Opened ${count} collection${count === 1 ? '' : 's'}` : '',
                null
            );
            return outcome;
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
     * @param {string} path
     * @returns {Promise<Object>}
     */
    async relocateCollection(collectionId, path) {
        return this.repository.relocate(collectionId, path);
    }

    /**
     * @param {string} successLabel
     * @param {function(): Promise<Object>} exportCall
     * @returns {Promise<Object>}
     */
    async _runExport(successLabel, exportCall) {
        try {
            this.statusDisplay.update('Exporting collection...', null);

            const result = await exportCall();

            if (result.cancelled) {
                this.statusDisplay.update('Export cancelled', null);
                return { success: false, cancelled: true };
            }

            if (result.success) {
                let message = successLabel;
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
     * @param {string} collectionId
     * @param {string} format
     * @returns {Promise<Object>}
     */
    async exportCollectionAsOpenApi(collectionId, format) {
        return this._runExport(
            `Collection exported successfully to ${format.toUpperCase()}`,
            () => window.backendAPI.collections.exportOpenApi(collectionId, format)
        );
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async exportCollectionAsPostman(collectionId) {
        return this._runExport(
            'Collection exported successfully to Postman',
            () => window.backendAPI.collections.exportPostman(collectionId)
        );
    }

    /**
     * @param {string|{name: string, storageParentPath?: string}} nameOrOptions
     * @returns {Promise<Object>}
     */
    async createCollection(nameOrOptions) {
        return this._reporting('Error creating collection', async () => {
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
        });
    }

    /** @returns {string} */
    generateCollectionId() {
        return generateId('collection');
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object|undefined>}
     */
    async _readFresh(collectionId) {
        if (typeof this.repository.readForUpdate === 'function') {
            return this.repository.readForUpdate(collectionId);
        }
        return this.repository.getById(collectionId);
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
        return this._reporting('Error adding request', async () => {
            this.statusDisplay.update('Adding new request...', null);

            const collection = await this._requireFresh(collectionId);

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

            if (requestData.folderId) {
                const placed = insertRequest(collection, requestData.folderId, newEndpoint);
                await this.repository.saveOne(placed, { newRequestIds: [newEndpoint.id] });
                await this.persistNewEndpointSidecars(collectionId, newEndpoint.id, descriptor, requestData);
                this.statusDisplay.update(`Added new request: ${requestData.name}`, null);
                return newEndpoint;
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

            await this.repository.saveOne(collection, { newRequestIds: [newEndpoint.id] });

            await this.persistNewEndpointSidecars(collectionId, newEndpoint.id, descriptor, requestData);

            this.statusDisplay.update(`Added new request: ${requestData.name}`, null);
            return newEndpoint;
        });
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
            const { password: _password, ...mqttData } = normalizeMqttData(requestData);
            await this.repository.saveMqttData(collectionId, endpointId, mqttData);
        }
    }

    /**
     * @param {Object} collection
     * @returns {string}
     */
    generateEndpointId(collection) {
        const existingIds = new Set(flattenRequests(collection).map(endpoint => endpoint.id));

        let newId = generateId('req');
        while (existingIds.has(newId)) {
            newId = generateId('req');
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
     * @returns {Promise<Object>}
     */
    async _requireFresh(collectionId) {
        const collection = await this._readFresh(collectionId);
        if (!collection) {
            throw new Error(`Collection with id ${collectionId} not found`);
        }
        return collection;
    }

    /**
     * @param {string} collectionId
     * @param {string|null} parentFolderId
     * @param {string} name
     * @returns {Promise<Object>}
     */
    async createFolder(collectionId, parentFolderId, name) {
        const collection = await this._requireFresh(collectionId);
        const folder = { id: this._uniqueFolderId(name, collection), name };
        await this.repository.saveOne(insertFolder(collection, parentFolderId, folder));
        return folder;
    }

    /**
     * @param {string} collectionId
     * @param {string} folderId
     * @param {string} name
     * @returns {Promise<void>}
     */
    async renameFolder(collectionId, folderId, name) {
        const collection = await this._requireFresh(collectionId);
        const renamed = updateFolder(collection, folderId, { name });
        if (!renamed) {
            throw new Error(`Folder with id ${folderId} not found in collection`);
        }
        await this.repository.saveOne(renamed);
    }

    /**
     * @param {string} collectionId
     * @param {string} folderId
     * @returns {Promise<Array<string>>}
     */
    async deleteFolder(collectionId, folderId) {
        return this.repository.deleteFolder(collectionId, folderId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} copyName
     * @returns {Promise<Object>}
     */
    async duplicateRequest(collectionId, endpointId, copyName) {
        const collection = await this._requireFresh(collectionId);
        const source = findRequest(collection, endpointId);
        if (!source) {
            throw new Error(`Endpoint with id ${endpointId} not found in collection`);
        }
        const folderId = folderChainForRequest(collection, endpointId).at(-1)?.id ?? null;
        const copy = { ...JSON.parse(JSON.stringify(source)), id: this.generateEndpointId(collection), name: copyName };
        await this.repository.saveOne(insertRequest(collection, folderId, copy), { newRequestIds: [copy.id] });
        await this.repository.copyEndpointData(collectionId, endpointId, copy.id);
        return copy;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string|null} targetFolderId
     * @returns {Promise<void>}
     */
    async moveRequestToFolder(collectionId, endpointId, targetFolderId) {
        const collection = await this._requireFresh(collectionId);
        if (targetFolderId && !findFolder(collection, targetFolderId)) {
            throw new Error(`Folder with id ${targetFolderId} not found in collection`);
        }
        const moved = moveRequest(collection, endpointId, targetFolderId);
        if (!moved) {
            throw new Error(`Endpoint with id ${endpointId} not found in collection`);
        }
        await this.repository.saveOne(moved);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} newName
     * @returns {Promise<Object>}
     */
    async renameRequest(collectionId, endpointId, newName) {
        return this._reporting('Error renaming request', async () => {
            this.statusDisplay.update('Renaming request...', null);

            const collection = await this._requireFresh(collectionId);

            const renamed = updateRequest(collection, endpointId, { name: newName });
            if (!renamed) {
                throw new Error(`Endpoint with id ${endpointId} not found in collection`);
            }

            const updatedEndpoint = findRequest(renamed, endpointId);

            await this.repository.saveOne(renamed);

            this.statusDisplay.update(`Request renamed to "${newName}"`, null);
            return updatedEndpoint;
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<boolean>}
     */
    async deleteRequestFromCollection(collectionId, endpointId) {
        return this._reporting('Error deleting request', async () => {
            this.statusDisplay.update('Deleting request...', null);

            const collection = await this._requireFresh(collectionId);

            const reduced = removeRequest(collection, endpointId) ?? collection;

            await this.repository.saveOne(reduced);

            await this.repository.deletePersistedEndpointData(collectionId, endpointId);

            this.statusDisplay.update('Request deleted successfully', null);
            return true;
        });
    }

    async saveRequestBodyModification(collectionId, endpointId) {
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

        const formBody = captureFormBody(bodyMode);
        if (formBody) {
            state.formBodyData = formBody;
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
        } catch {
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
     * @param {string} listKey
     * @param {string} repositoryMethod
     * @returns {Promise<void>}
     */
    async _saveRows(collectionId, endpointId, formElements, listKey, repositoryMethod) {
        try {
            const rows = this.parseKeyValuePairs(formElements[listKey]);
            await this.repository[repositoryMethod](collectionId, endpointId, rows);
        } catch {
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
     * @returns {Promise<void>}
     */
    async saveCurrentPathParams(collectionId, endpointId, formElements) {
        await this._saveRows(collectionId, endpointId, formElements, 'pathParamsList', 'savePersistedPathParams');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
     * @returns {Promise<void>}
     */
    async saveCurrentQueryParams(collectionId, endpointId, formElements) {
        await this._saveRows(collectionId, endpointId, formElements, 'queryParamsList', 'savePersistedQueryParams');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} formElements
     * @returns {Promise<void>}
     */
    async saveCurrentHeaders(collectionId, endpointId, formElements) {
        await this._saveRows(collectionId, endpointId, formElements, 'headersList', 'savePersistedHeaders');
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
