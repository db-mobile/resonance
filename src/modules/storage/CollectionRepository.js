/**
 * @fileoverview Repository for managing collection data persistence
 * @module storage/CollectionRepository
 */

import { splitAuthSecrets, mergeAuthSecrets, authSecretScope, collectionAuthSecretScope, folderAuthSecretScope } from '../auth/authSecrets.js';
import { findFolder, folderChainForRequest, updateFolder } from '../collections/collectionTree.js';
import { fromWire, toWire, listFromWire } from './collectionMapper.js';

const METADATA_FIELDS = Object.freeze([
    'name',
    'baseUrl',
    'defaultHeaders',
    'authConfig',
    'storagePath',
    'storageParentPath'
]);

export class CollectionRepository {
    static MAX_CACHE_SIZE = 20;

    /**
     * @param {Object} backendAPI
     * @param {import('./SecretStore.js').SecretStore} [secretStore]
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.secretStore = secretStore;
        this._byIdCache = new Map();
        this._endpointWriteQueues = new Map();
    }

    _addToCache(id, collection) {
        if (this._byIdCache.has(id)) {
            this._byIdCache.delete(id);
        }
        if (this._byIdCache.size >= CollectionRepository.MAX_CACHE_SIZE) {
            const oldestKey = this._byIdCache.keys().next().value;
            this._byIdCache.delete(oldestKey);
        }
        this._byIdCache.set(id, collection);
    }

    /** @returns {Promise<Array<Object>>} */
    async getAll() {
        try {
            const collections = await this.backendAPI.collections.getAll();
            return listFromWire(collections);
        } catch (error) {
            throw new Error(`Failed to load collections: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {Object} collection
     * @returns {Promise<void>}
     */
    async saveOne(collection) {
        try {
            await this.backendAPI.collections.save(toWire(collection));
            if (collection?.id) {
                this._addToCache(collection.id, collection);
            }
        } catch (error) {
            throw new Error(`Failed to save collection: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async getById(id) {
        if (this._byIdCache.has(id)) {
            const cached = this._byIdCache.get(id);
            this._byIdCache.delete(id);
            this._byIdCache.set(id, cached);
            return cached;
        }
        try {
            const collection = fromWire(await this.backendAPI.collections.get(id));
            if (collection) {
                this._addToCache(id, collection);
            }
            return collection ?? undefined;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * @param {Object} collection
     * @returns {Promise<Object>}
     */
    async add(collection) {
        await this.saveOne(collection);
        return collection;
    }

    /**
     * @param {string} id
     * @param {Object} patch
     * @returns {Promise<Object>}
     */
    async updateMetadata(id, patch) {
        const unsupported = Object.keys(patch).filter(
            (key) => !METADATA_FIELDS.includes(key)
        );
        if (unsupported.length > 0) {
            throw new Error(
                `updateMetadata cannot patch ${unsupported.join(', ')}; use saveTree() or saveOne()`
            );
        }

        const existing = await this.getById(id);

        if (!existing) {
            throw new Error(`Collection with id ${id} not found`);
        }

        const merged = { ...existing, ...patch };
        await this.saveOne(merged);
        return merged;
    }

    /**
     * @param {string} id
     * @param {Object} tree
     * @param {Array} [tree.items]
     * @param {Array} [tree.endpoints]
     * @param {Array} [tree.folders]
     * @returns {Promise<Object>}
     */
    async saveTree(id, { items, endpoints, folders }) {
        const existing = await this.getById(id);

        if (!existing) {
            throw new Error(`Collection with id ${id} not found`);
        }

        const merged = { ...existing };
        for (const [field, value] of Object.entries({ items, endpoints, folders })) {
            if (value !== undefined) {
                merged[field] = value;
            }
        }

        await this.saveOne(merged);
        return merged;
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        try {
            await this.backendAPI.collections.delete(id);
            this._byIdCache.delete(id);
            if (this.secretStore) {
                await this.secretStore.deleteScopePrefix(`auth:${id}:`);
            }
            return true;
        } catch (error) {
            throw new Error(`Failed to delete collection: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async close(id) {
        try {
            await this.backendAPI.collections.close(id);
            this._byIdCache.delete(id);
            return true;
        } catch (error) {
            throw new Error(`Failed to close collection: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} path
     * @returns {Promise<Object>}
     */
    async openExisting(path) {
        return this.backendAPI.collections.openExisting(path);
    }

    /** @returns {Promise<Object>} */
    async gitBranches() {
        return this.backendAPI.collections.gitBranches();
    }

    async _getEndpointData(collectionId, endpointId) {
        try {
            return await this.backendAPI.collections.getEndpointData(collectionId, endpointId);
        } catch (error) {
            return {};
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object>}
     */
    async getAllPersistedEndpointData(collectionId, endpointId) {
        const data = await this._getEndpointData(collectionId, endpointId);
        return {
            url: data.url || null,
            authConfig: data.authConfig || null,
            pathParams: data.pathParams || [],
            queryParams: data.queryParams || [],
            headers: data.headers || [],
            modifiedBody: data.modifiedBody || null,
            graphqlData: data.graphqlData || null,
            formBodyData: data.formBodyData || null,
            grpcData: data.grpcData || null,
            mqttData: data.mqttData || null,
            responseSchema: data.responseSchema || null
        };
    }

    async _saveEndpointData(collectionId, endpointId, data) {
        await this.backendAPI.collections.saveEndpointData(collectionId, endpointId, data);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object>}
     */
    async _getEndpointDataForUpdate(collectionId, endpointId) {
        return this.backendAPI.collections.getEndpointData(collectionId, endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {function(): Promise<*>} write
     * @returns {Promise<*>}
     */
    async _withEndpointWrite(collectionId, endpointId, write) {
        const key = `${collectionId}::${endpointId}`;
        const previous = this._endpointWriteQueues.get(key) || Promise.resolve();
        const current = previous.catch(() => {}).then(write);
        this._endpointWriteQueues.set(key, current);
        try {
            return await current;
        } finally {
            if (this._endpointWriteQueues.get(key) === current) {
                this._endpointWriteQueues.delete(key);
            }
        }
    }

    async _updateEndpointField(collectionId, endpointId, field, value) {
        await this._withEndpointWrite(collectionId, endpointId, async () => {
            const data = await this._getEndpointDataForUpdate(collectionId, endpointId);
            data[field] = value;
            await this._saveEndpointData(collectionId, endpointId, data);
        });
    }

    async _updateEndpointFields(collectionId, endpointId, updates) {
        await this._withEndpointWrite(collectionId, endpointId, async () => {
            const data = await this._getEndpointDataForUpdate(collectionId, endpointId);
            Object.assign(data, updates);
            await this._saveEndpointData(collectionId, endpointId, data);
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} field
     * @param {*} empty
     * @returns {Promise<*>}
     */
    async _readSidecar(collectionId, endpointId, field, empty) {
        const data = await this._getEndpointData(collectionId, endpointId);
        return data[field] || empty;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} field
     * @param {*} value
     * @param {string} label
     * @returns {Promise<void>}
     */
    async _writeSidecar(collectionId, endpointId, field, value, label) {
        try {
            await this._updateEndpointField(collectionId, endpointId, field, value);
        } catch (error) {
            throw new Error(`Failed to save ${label}: ${error.message || error}`, { cause: error });
        }
    }

    async updateEndpointFields(collectionId, endpointId, updates) {
        try {
            await this._updateEndpointFields(collectionId, endpointId, updates);
        } catch (error) {
            throw new Error(`Failed to update endpoint fields: ${error.message || error}`, { cause: error });
        }
    }

    async saveBodyState(collectionId, endpointId, { modifiedBody = null, formBodyData = null, graphqlData = null } = {}) {
        try {
            await this._updateEndpointFields(collectionId, endpointId, {
                modifiedBody,
                formBodyData,
                graphqlData
            });
        } catch (error) {
            throw new Error(`Failed to save body state: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<string|null>}
     */
    async getModifiedRequestBody(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'modifiedBody', null);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} body
     * @returns {Promise<void>}
     */
    async saveModifiedRequestBody(collectionId, endpointId, body) {
        return this._writeSidecar(collectionId, endpointId, 'modifiedBody', body, 'modified request body');
    }

    async getFormBodyData(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'formBodyData', null);
    }

    async saveFormBodyData(collectionId, endpointId, data) {
        return this._writeSidecar(collectionId, endpointId, 'formBodyData', data, 'form body data');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Array>}
     */
    async getPersistedPathParams(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'pathParams', []);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Array} pathParams
     * @returns {Promise<void>}
     */
    async savePersistedPathParams(collectionId, endpointId, pathParams) {
        return this._writeSidecar(collectionId, endpointId, 'pathParams', pathParams, 'persisted path params');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Array>}
     */
    async getPersistedQueryParams(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'queryParams', []);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Array} queryParams
     * @returns {Promise<void>}
     */
    async savePersistedQueryParams(collectionId, endpointId, queryParams) {
        return this._writeSidecar(collectionId, endpointId, 'queryParams', queryParams, 'persisted query params');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Array>}
     */
    async getPersistedHeaders(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'headers', []);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Array} headers
     * @returns {Promise<void>}
     */
    async savePersistedHeaders(collectionId, endpointId, headers) {
        return this._writeSidecar(collectionId, endpointId, 'headers', headers, 'persisted headers');
    }

    /**
     * @param {string} scope
     * @param {Object|null} authConfig
     * @returns {Promise<Object|null>}
     */
    async _hydrateAuthConfig(scope, authConfig) {
        if (!authConfig || !this.secretStore) {
            return authConfig;
        }
        const secrets = await this.secretStore.getScope(scope);
        return mergeAuthSecrets(authConfig, secrets);
    }

    /**
     * @param {string} scope
     * @param {Object|null} authConfig
     * @returns {Promise<Object|null>}
     */
    async _persistAuthSecrets(scope, authConfig) {
        if (!authConfig || !this.secretStore) {
            return authConfig;
        }

        const { redacted, secrets } = splitAuthSecrets(authConfig);

        for (const field of Object.keys(secrets)) {
            await this.secretStore.set(scope, field, secrets[field]);
        }

        const stored = await this.secretStore.getScope(scope);
        for (const field of Object.keys(stored)) {
            if (!Object.prototype.hasOwnProperty.call(secrets, field)) {
                await this.secretStore.delete(scope, field);
            }
        }

        return redacted;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getPersistedAuthConfig(collectionId, endpointId) {
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return this._hydrateAuthConfig(
                authSecretScope(collectionId, endpointId),
                data.authConfig || null
            );
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} authConfig
     * @returns {Promise<void>}
     */
    async savePersistedAuthConfig(collectionId, endpointId, authConfig) {
        try {
            const toPersist = await this._persistAuthSecrets(
                authSecretScope(collectionId, endpointId),
                authConfig
            );
            await this._updateEndpointField(collectionId, endpointId, 'authConfig', toPersist);
        } catch (error) {
            throw new Error(`Failed to save persisted auth config: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object|null>}
     */
    async getCollectionAuthConfig(collectionId) {
        try {
            const collection = await this._getByIdFresh(collectionId);
            return this._hydrateAuthConfig(
                collectionAuthSecretScope(collectionId),
                collection?.authConfig || null
            );
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {Object} authConfig
     * @returns {Promise<void>}
     */
    async saveCollectionAuthConfig(collectionId, authConfig) {
        try {
            const toPersist = await this._persistAuthSecrets(
                collectionAuthSecretScope(collectionId),
                authConfig
            );
            const collection = await this._getByIdFresh(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }
            await this.updateMetadata(collectionId, { authConfig: toPersist });
        } catch (error) {
            throw new Error(`Failed to save collection auth config: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async _readFromBackend(id) {
        try {
            return fromWire(await this.backendAPI.collections.get(id)) ?? undefined;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async _getByIdFresh(id) {
        const collection = await this._readFromBackend(id);
        if (collection) {
            this._addToCache(id, collection);
        }
        return collection;
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async readForUpdate(id) {
        return this._readFromBackend(id);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async findFolderForEndpoint(collectionId, endpointId) {
        try {
            const collection = await this._getByIdFresh(collectionId);
            return folderChainForRequest(collection, endpointId).at(-1) || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} folderId
     * @returns {Promise<Object|null>}
     */
    async getFolderAuthConfig(collectionId, folderId) {
        try {
            const collection = await this._getByIdFresh(collectionId);
            const folder = findFolder(collection, folderId);
            return this._hydrateAuthConfig(
                folderAuthSecretScope(collectionId, folderId),
                folder?.authConfig || null
            );
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} folderId
     * @param {Object} authConfig
     * @returns {Promise<void>}
     */
    async saveFolderAuthConfig(collectionId, folderId, authConfig) {
        try {
            const toPersist = await this._persistAuthSecrets(
                folderAuthSecretScope(collectionId, folderId),
                authConfig
            );
            const collection = await this._getByIdFresh(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }
            const updated = updateFolder(collection, folderId, { authConfig: toPersist });
            if (!updated) {
                throw new Error(`Folder with id ${folderId} not found in collection`);
            }
            await this.saveTree(collectionId, updated);
        } catch (error) {
            throw new Error(`Failed to save folder auth config: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} [endpointId]
     * @returns {Promise<Object|null>}
     */
    async getInheritedAuthConfig(collectionId, endpointId) {
        try {
            if (endpointId) {
                const collection = await this._getByIdFresh(collectionId);
                const chain = folderChainForRequest(collection, endpointId);

                for (let index = chain.length - 1; index >= 0; index -= 1) {
                    const folder = chain[index];
                    if (folder?.authConfig?.type && folder.authConfig.type !== 'inherit') {
                        return this.getFolderAuthConfig(collectionId, folder.id);
                    }
                }
            }
            return this.getCollectionAuthConfig(collectionId);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<string|null>}
     */
    async getPersistedUrl(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'url', null);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} url
     * @returns {Promise<void>}
     */
    async savePersistedUrl(collectionId, endpointId, url) {
        return this._writeSidecar(collectionId, endpointId, 'url', url, 'persisted URL');
    }

    /** @returns {Promise<Object>} */
    async getCollectionExpansionStates() {
        try {
            const data = await this.backendAPI.store.get('collectionExpansionStates');
            return data || {};
        } catch (error) {
            return {};
        }
    }

    /**
     * @param {Object} expansionStates
     * @returns {Promise<void>}
     */
    async saveCollectionExpansionStates(expansionStates) {
        try {
            await this.backendAPI.store.set('collectionExpansionStates', expansionStates);
        } catch (error) {
            throw new Error(`Failed to save collection expansion states: ${error.message || error}`, { cause: error });
        }
    }

    async getPinnedRequests() {
        try {
            const data = await this.backendAPI.store.get('pinnedRequests');
            return data || {};
        } catch (error) {
            return {};
        }
    }

    async togglePinnedRequest(collectionId, endpointId) {
        try {
            const pinned = await this.getPinnedRequests();
            const key = `${collectionId}_${endpointId}`;
            pinned[key] = !pinned[key];
            if (!pinned[key]) {
                delete pinned[key];
            }
            await this.backendAPI.store.set('pinnedRequests', pinned);
            return !!pinned[key];
        } catch (error) {
            throw new Error(`Failed to toggle pinned request: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async deletePersistedEndpointData(collectionId, endpointId) {
        try {
            await this.backendAPI.collections.deleteEndpointData(collectionId, endpointId);
            if (this.secretStore) {
                await this.secretStore.deleteScope(authSecretScope(collectionId, endpointId));
            }
        } catch (error) {
            throw new Error(`Failed to delete persisted endpoint data: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveLastSelectedRequest(collectionId, endpointId) {
        try {
            await this.backendAPI.store.set('lastSelectedRequest', {
                collectionId,
                endpointId
            });
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async clearLastSelectedRequest() {
        try {
            await this.backendAPI.store.set('lastSelectedRequest', null);
        } catch (error) {
            throw new Error(`Failed to clear last selected request: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveGraphQLData(collectionId, endpointId, data) {
        return this._writeSidecar(collectionId, endpointId, 'graphqlData', data, 'GraphQL data');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getGraphQLData(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'graphqlData', null);
    }

    async saveGrpcData(collectionId, endpointId, data) {
        return this._writeSidecar(collectionId, endpointId, 'grpcData', data, 'gRPC data');
    }

    async getGrpcData(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'grpcData', null);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} data
     * @returns {Promise<void>}
     */
    async saveMqttData(collectionId, endpointId, data) {
        return this._writeSidecar(collectionId, endpointId, 'mqttData', data, 'MQTT data');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getMqttData(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'mqttData', null);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object|null} schema
     * @returns {Promise<void>}
     */
    async saveResponseSchema(collectionId, endpointId, schema) {
        return this._writeSidecar(collectionId, endpointId, 'responseSchema', schema, 'response schema');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getResponseSchema(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'responseSchema', null);
    }
}
