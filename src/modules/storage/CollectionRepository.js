/**
 * @fileoverview Repository for managing collection data persistence
 * @module storage/CollectionRepository
 */

import { splitAuthSecrets, mergeAuthSecrets, authSecretScope, collectionAuthSecretScope, folderAuthSecretScope } from '../auth/authSecrets.js';
import { findFolder, folderChainForRequest, updateFolder } from '../collections/collectionTree.js';
import { fromWire, toWire, listFromWire } from './collectionMapper.js';

/**
 * Collection fields updateMetadata() may patch. The request tree is excluded:
 * a shallow merge of two trees is meaningless, so it goes through saveTree().
 */
const METADATA_FIELDS = Object.freeze([
    'name',
    'baseUrl',
    'defaultHeaders',
    'authConfig',
    'storagePath',
    'storageParentPath'
]);

/**
 * Repository for managing collection data persistence
 *
 * @class
 * @classdesc Handles all CRUD operations for collections using file-based storage.
 * Each collection is stored in its own directory with separate files for
 * collection metadata, endpoint data, and variables. This enables Git-friendly
 * storage with clean diffs and partial reads.
 * 
 * File structure:
 * ~/.local/share/io.github.db_mobile.resonance/collections/
 * ├── {collection_id}/
 * │   ├── collection.json    # Collection metadata + endpoints
 * │   ├── variables.json     # Collection-specific variables
 * │   └── requests/          # Endpoint-specific data
 * │       ├── {endpoint_id}.json
 * │       └── ...
 */
export class CollectionRepository {
    /**
     * Maximum number of collections to keep in cache.
     * Prevents unbounded memory growth for users with many collections.
     * @private
     */
    static MAX_CACHE_SIZE = 20;

    /**
     * Creates a CollectionRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     * @param {import('./SecretStore.js').SecretStore} [secretStore] - Optional secret
     *   backend; when provided, literal auth credentials are kept out of the
     *   git-friendly collection files and rehydrated on read.
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.secretStore = secretStore;
        this._byIdCache = new Map();
    }

    /**
     * Adds an item to cache with LRU eviction if cache is full
     * @private
     */
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

    /**
     * Retrieves all collections from storage
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects
     * @throws {Error} If storage access fails
     */
    async getAll() {
        try {
            const collections = await this.backendAPI.collections.getAll();
            return listFromWire(collections);
        } catch (error) {
            throw new Error(`Failed to load collections: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * Saves a single collection to storage
     *
     * @async
     * @param {Object} collection - The collection object to save
     * @returns {Promise<void>}
     * @throws {Error} If storage write fails
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
     * Retrieves a collection by its ID
     *
     * @async
     * @param {string} id - The collection ID
     * @returns {Promise<Object|undefined>} The collection object or undefined if not found
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
     * Adds a new collection to storage
     *
     * @async
     * @param {Object} collection - The collection object to add
     * @returns {Promise<Object>} The added collection object
     * @throws {Error} If save operation fails
     */
    async add(collection) {
        await this.saveOne(collection);
        return collection;
    }

    /**
     * Updates a collection's own metadata, leaving its request tree alone.
     *
     * Restricted to the scalar fields on purpose: a shallow merge cannot
     * meaningfully combine two request trees, so patching `endpoints`/`folders`
     * this way would silently replace one wholesale. Use saveTree() for the
     * tree and saveOne() for a whole collection read for update.
     *
     * @async
     * @param {string} id - The collection ID to update
     * @param {Object} patch - Metadata fields to merge in
     * @returns {Promise<Object>} The updated collection object
     * @throws {Error} If the collection is missing or the patch touches the tree
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
     * Replaces a collection's request tree, leaving its metadata alone.
     *
     * @async
     * @param {string} id - The collection ID to update
     * @param {Object} tree - The tree to persist
     * @param {Array} [tree.items] - The nested request tree
     * @param {Array} [tree.endpoints] - Root-level endpoints (legacy shape)
     * @param {Array} [tree.folders] - Folders and their endpoints (legacy shape)
     * @returns {Promise<Object>} The updated collection object
     * @throws {Error} If the collection is missing or the save fails
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
     * Deletes a collection by ID
     *
     * @async
     * @param {string} id - The collection ID to delete
     * @returns {Promise<boolean>} True if deletion succeeded
     * @throws {Error} If delete operation fails
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
     * Removes a collection from the list without touching its files.
     *
     * The counterpart to opening a collection in place. Stored credentials are
     * deliberately kept: they are the only part of such a collection that does
     * not live in its directory, and re-opening the same directory restores it
     * under the same id, so discarding them would make Close destructive in
     * the one dimension the files are not.
     *
     * @async
     * @param {string} id - The collection ID to close
     * @returns {Promise<boolean>} True when the collection is no longer listed
     * @throws {Error} If the backend call fails
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
     * Registers an existing collection directory, using it where it is.
     *
     * @async
     * @param {string} path - The directory the user picked
     * @returns {Promise<Object>} `{ opened, alreadyOpen, failed }`
     * @throws {Error} If nothing there can be opened
     */
    async openExisting(path) {
        return this.backendAPI.collections.openExisting(path);
    }

    /**
     * Reads the current Git branch of every registered collection.
     *
     * Cheaper than reloading collections: the backend answers from the
     * collection index without touching a single request file.
     *
     * @async
     * @returns {Promise<Object>} Branch name keyed by collection ID, omitting collections outside a repository
     */
    async gitBranches() {
        return this.backendAPI.collections.gitBranches();
    }

    /**
     * Helper to get endpoint data
     * @private
     */
    async _getEndpointData(collectionId, endpointId) {
        try {
            return await this.backendAPI.collections.getEndpointData(collectionId, endpointId);
        } catch (error) {
            return {};
        }
    }

    /**
     * Retrieves all persisted data for an endpoint in a single IPC call
     *
     * This is more efficient than calling individual getters (getPersistedUrl,
     * getPersistedAuthConfig, etc.) which each make separate IPC calls.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Object>} Object containing all persisted endpoint data
     * @returns {string|null} return.url - Persisted URL
     * @returns {Object|null} return.authConfig - Authentication configuration
     * @returns {Array} return.pathParams - Path parameters
     * @returns {Array} return.queryParams - Query parameters
     * @returns {Array} return.headers - Headers
     * @returns {string|null} return.modifiedBody - Modified request body
     * @returns {Object|null} return.graphqlData - GraphQL data
     * @returns {Object|null} return.grpcData - gRPC data
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

    /**
     * Helper to save endpoint data
     * @private
     */
    async _saveEndpointData(collectionId, endpointId, data) {
        await this.backendAPI.collections.saveEndpointData(collectionId, endpointId, data);
    }

    /**
     * Helper to update a single field in endpoint data
     * @private
     */
    async _updateEndpointField(collectionId, endpointId, field, value) {
        const data = await this._getEndpointData(collectionId, endpointId);
        data[field] = value;
        await this._saveEndpointData(collectionId, endpointId, data);
    }

    async _updateEndpointFields(collectionId, endpointId, updates) {
        const data = await this._getEndpointData(collectionId, endpointId);
        Object.assign(data, updates);
        await this._saveEndpointData(collectionId, endpointId, data);
    }

    /**
     * Reads one sidecar field, falling back to `empty` (`_getEndpointData` already absorbs read failures).
     *
     * @private
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {string} field - Sidecar field name
     * @param {*} empty - Value to return when the field holds nothing
     * @returns {Promise<*>} The stored value or `empty`
     */
    async _readSidecar(collectionId, endpointId, field, empty) {
        const data = await this._getEndpointData(collectionId, endpointId);
        return data[field] || empty;
    }

    /**
     * Writes one sidecar field, leaving its siblings intact.
     *
     * @private
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {string} field - Sidecar field name
     * @param {*} value - Value to persist
     * @param {string} label - Human-readable field name for the error message
     * @returns {Promise<void>}
     * @throws {Error} If the write fails
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
     * Retrieves modified request body for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<string|null>} The modified request body or null if not found
     */
    async getModifiedRequestBody(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'modifiedBody', null);
    }

    /**
     * Saves modified request body for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {string} body - The modified request body
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
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
     * Retrieves persisted path parameters for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Array>} Array of path parameter objects or empty array
     */
    async getPersistedPathParams(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'pathParams', []);
    }

    /**
     * Saves path parameters for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Array} pathParams - Array of path parameter objects
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async savePersistedPathParams(collectionId, endpointId, pathParams) {
        return this._writeSidecar(collectionId, endpointId, 'pathParams', pathParams, 'persisted path params');
    }

    /**
     * Retrieves persisted query parameters for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Array>} Array of query parameter objects or empty array
     */
    async getPersistedQueryParams(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'queryParams', []);
    }

    /**
     * Saves query parameters for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Array} queryParams - Array of query parameter objects
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async savePersistedQueryParams(collectionId, endpointId, queryParams) {
        return this._writeSidecar(collectionId, endpointId, 'queryParams', queryParams, 'persisted query params');
    }

    /**
     * Retrieves persisted headers for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Array>} Array of header objects or empty array
     */
    async getPersistedHeaders(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'headers', []);
    }

    /**
     * Saves headers for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Array} headers - Array of header objects
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async savePersistedHeaders(collectionId, endpointId, headers) {
        return this._writeSidecar(collectionId, endpointId, 'headers', headers, 'persisted headers');
    }

    /**
     * Merges a scope's stored secrets back into a persisted auth config.
     *
     * @private
     * @async
     * @param {string} scope - SecretStore scope owning this config's secrets
     * @param {Object|null} authConfig - The redacted config as persisted
     * @returns {Promise<Object|null>} The hydrated config, or the input unchanged when there is nothing to merge
     */
    async _hydrateAuthConfig(scope, authConfig) {
        if (!authConfig || !this.secretStore) {
            return authConfig;
        }
        const secrets = await this.secretStore.getScope(scope);
        return mergeAuthSecrets(authConfig, secrets);
    }

    /**
     * Moves literal credentials into `scope`, prunes ones the config dropped, and returns the redacted copy.
     *
     * @private
     * @async
     * @param {string} scope - SecretStore scope to own this config's secrets
     * @param {Object|null} authConfig - The config as supplied by the caller
     * @returns {Promise<Object|null>} The redacted config to persist, or the input unchanged when there is no secret store
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
     * Retrieves persisted authentication config for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Object|null>} The auth config object or null if not found
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
     * Saves authentication config for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} authConfig - The authentication configuration object
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
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
     * Retrieves the collection-level auth config, with secret fields merged
     * back from the SecretStore.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Object|null>} The auth config ({type, config}) or null
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
     * Saves the collection-level auth config. Literal secret values are moved
     * into the SecretStore (scope auth:<collectionId>:__collection__) and the
     * persisted collection.json keeps a redacted copy.
     *
     * Reads the collection fresh before updating so the merge in `update()` sees
     * auth edits made through a sibling repository instance rather than this
     * instance's cached copy.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {Object} authConfig - The authentication configuration ({type, config})
     * @returns {Promise<void>}
     * @throws {Error} If the collection is missing or the save fails
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
     * Reads one collection straight from the backend, without consulting or
     * touching the cache.
     *
     * @private
     * @async
     * @param {string} id - The collection ID
     * @returns {Promise<Object|undefined>} The collection or undefined
     */
    async _readFromBackend(id) {
        try {
            return fromWire(await this.backendAPI.collections.get(id)) ?? undefined;
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Reads a collection directly from the backend, bypassing (and refreshing)
     * this instance's LRU cache. Several repository instances exist at runtime
     * (controller, apiHandler, runner), each with its own cache; auth
     * resolution must see edits saved through any of them, so it never trusts
     * a cached copy.
     *
     * @private
     * @async
     * @param {string} id - The collection ID
     * @returns {Promise<Object|undefined>} The collection or undefined
     */
    async _getByIdFresh(id) {
        const collection = await this._readFromBackend(id);
        if (collection) {
            this._addToCache(id, collection);
        }
        return collection;
    }

    /**
     * Reads one collection for a read-modify-write cycle: callers mutate the
     * returned object in place and then persist it with saveOne().
     *
     * Deliberately leaves the cache untouched. Caching an object that is about
     * to be mutated would let a failed write strand mutated-but-unpersisted
     * state where getById() would serve it as truth; saveOne() caches the
     * object once the write succeeds, so the cache only ever holds persisted
     * state. Reading a single collection also keeps an edit to one request from
     * depending on every collection being readable.
     *
     * @async
     * @param {string} id - The collection ID
     * @returns {Promise<Object|undefined>} The collection or undefined
     */
    async readForUpdate(id) {
        return this._readFromBackend(id);
    }

    /**
     * Finds the folder that contains an endpoint, if any. Reads fresh so
     * cross-instance auth edits are visible.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Object|null>} The folder object or null
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
     * Retrieves a folder's auth config, with secret fields merged back from
     * the SecretStore.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} folderId - The folder ID
     * @returns {Promise<Object|null>} The auth config ({type, config}) or null
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
     * Saves a folder's auth config. Literal secret values are moved into the
     * SecretStore (scope auth:<collectionId>:__folder__:<folderId>) and the
     * persisted collection.json keeps a redacted copy on the folder object.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} folderId - The folder ID
     * @param {Object} authConfig - The authentication configuration ({type, config})
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
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
     * Resolves the auth config an endpoint inherits: the nearest enclosing
     * folder that defines one (explicit "none" opts that subtree out),
     * otherwise the collection's auth. Secrets are merged in either case.
     *
     * Walks the folder chain innermost-first, so a nested folder's auth wins
     * over its parent's.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} [endpointId] - The endpoint ID (for folder lookup)
     * @returns {Promise<Object|null>} The inherited auth config or null
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
     * Retrieves persisted URL for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<string|null>} The persisted URL or null if not found
     */
    async getPersistedUrl(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'url', null);
    }

    /**
     * Saves URL for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {string} url - The URL to persist
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async savePersistedUrl(collectionId, endpointId, url) {
        return this._writeSidecar(collectionId, endpointId, 'url', url, 'persisted URL');
    }

    /**
     * Retrieves collection expansion states for UI
     *
     * Note: UI state is still stored in the main store for simplicity
     *
     * @async
     * @returns {Promise<Object>} Object mapping collection IDs to expansion state
     */
    async getCollectionExpansionStates() {
        try {
            const data = await this.backendAPI.store.get('collectionExpansionStates');
            return data || {};
        } catch (error) {
            return {};
        }
    }

    /**
     * Saves collection expansion states for UI persistence
     *
     * @async
     * @param {Object} expansionStates - Object mapping collection IDs to expansion state
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
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
     * Deletes all persisted data for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     * @throws {Error} If delete operation fails
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
     * Saves the last selected request for UI state restoration
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
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

    /**
     * Clears the last selected request
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If clear operation fails
     */
    async clearLastSelectedRequest() {
        try {
            await this.backendAPI.store.set('lastSelectedRequest', null);
        } catch (error) {
            throw new Error(`Failed to clear last selected request: ${error.message || error}`, { cause: error });
        }
    }

    /**
     * Saves GraphQL data (query + variables) for an endpoint
     *
     * @async
     * @param {string} collectionId - The ID of the collection
     * @param {string} endpointId - The ID of the endpoint
     * @param {Object} data - GraphQL data { mode: 'graphql', query: '', variables: '' }
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async saveGraphQLData(collectionId, endpointId, data) {
        return this._writeSidecar(collectionId, endpointId, 'graphqlData', data, 'GraphQL data');
    }

    /**
     * Retrieves GraphQL data for an endpoint
     *
     * @async
     * @param {string} collectionId - The ID of the collection
     * @param {string} endpointId - The ID of the endpoint
     * @returns {Promise<Object|null>} GraphQL data or null if not found
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
     * Saves MQTT connection and topic settings for an endpoint
     *
     * @async
     * @param {string} collectionId - The ID of the collection
     * @param {string} endpointId - The ID of the endpoint
     * @param {Object} data - MQTT data { clientId, username, subscribeTopic, publishTopic, qos }
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async saveMqttData(collectionId, endpointId, data) {
        return this._writeSidecar(collectionId, endpointId, 'mqttData', data, 'MQTT data');
    }

    /**
     * Retrieves MQTT connection and topic settings for an endpoint
     *
     * @async
     * @param {string} collectionId - The ID of the collection
     * @param {string} endpointId - The ID of the endpoint
     * @returns {Promise<Object|null>} MQTT data or null if not found
     */
    async getMqttData(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'mqttData', null);
    }

    /**
     * Saves response schema for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object|null} schema - The JSON Schema object or null to clear
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async saveResponseSchema(collectionId, endpointId, schema) {
        return this._writeSidecar(collectionId, endpointId, 'responseSchema', schema, 'response schema');
    }

    /**
     * Retrieves response schema for a specific endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Object|null>} The JSON Schema object or null if not found
     */
    async getResponseSchema(collectionId, endpointId) {
        return this._readSidecar(collectionId, endpointId, 'responseSchema', null);
    }
}
