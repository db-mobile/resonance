/**
 * @fileoverview Repository for managing collection data persistence
 * @module storage/CollectionRepository
 */

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
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this._byIdCache = new Map();
    }

    /**
     * Adds an item to cache with LRU eviction if cache is full
     * @private
     */
    _addToCache(id, collection) {
        // If already in cache, delete to update insertion order
        if (this._byIdCache.has(id)) {
            this._byIdCache.delete(id);
        }
        // Evict oldest entry if at capacity
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
            return collections || [];
        } catch (error) {
            throw new Error(`Failed to load collections: ${error.message || error}`);
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
            await this.backendAPI.collections.save(collection);
            if (collection?.id) {
                this._addToCache(collection.id, collection);
            }
        } catch (error) {
            throw new Error(`Failed to save collection: ${error.message || error}`);
        }
    }

    /**
     * Saves collections array to storage (legacy compatibility)
     * 
     * Note: This method saves each collection individually. For better performance,
     * prefer using saveOne() when updating a single collection.
     *
     * @async
     * @param {Array<Object>} collections - Array of collection objects to save
     * @returns {Promise<void>}
     * @throws {Error} If storage write fails
     */
    async save(collections) {
        try {
            // Get existing collection IDs
            const existingIds = await this.backendAPI.collections.list();
            const newIds = collections.map(c => c.id);

            // Delete collections that no longer exist
            for (const id of existingIds) {
                if (!newIds.includes(id)) {
                    await this.backendAPI.collections.delete(id);
                }
            }

            // Save all collections
            for (const collection of collections) {
                await this.backendAPI.collections.save(collection);
            }
        } catch (error) {
            throw new Error(`Failed to save collections: ${error.message || error}`);
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
            // Move to end of Map to mark as recently used
            const cached = this._byIdCache.get(id);
            this._byIdCache.delete(id);
            this._byIdCache.set(id, cached);
            return cached;
        }
        try {
            const collection = await this.backendAPI.collections.get(id);
            if (collection) {
                this._addToCache(id, collection);
            }
            return collection;
        } catch (error) {
            // Collection not found
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
     * Updates an existing collection
     *
     * @async
     * @param {string} id - The collection ID to update
     * @param {Object} updatedCollection - Object with properties to update
     * @returns {Promise<Object>} The updated collection object
     * @throws {Error} If collection not found or save fails
     */
    async update(id, updatedCollection) {
        const existing = await this.getById(id);

        if (!existing) {
            throw new Error(`Collection with id ${id} not found`);
        }

        const merged = { ...existing, ...updatedCollection };
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
            return true;
        } catch (error) {
            throw new Error(`Failed to delete collection: ${error.message || error}`);
        }
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

    async updateEndpointFields(collectionId, endpointId, updates) {
        try {
            await this._updateEndpointFields(collectionId, endpointId, updates);
        } catch (error) {
            throw new Error(`Failed to update endpoint fields: ${error.message || error}`);
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
            throw new Error(`Failed to save body state: ${error.message || error}`);
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.modifiedBody || null;
        } catch (error) {
            return null;
        }
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'modifiedBody', body);
        } catch (error) {
            throw new Error(`Failed to save modified request body: ${error.message || error}`);
        }
    }

    async getFormBodyData(collectionId, endpointId) {
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data?.formBodyData || null;
        } catch (error) {
            return null;
        }
    }

    async saveFormBodyData(collectionId, endpointId, data) {
        try {
            await this._updateEndpointField(collectionId, endpointId, 'formBodyData', data);
        } catch (error) {
            throw new Error(`Failed to save form body data: ${error.message || error}`);
        }
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.pathParams || [];
        } catch (error) {
            return [];
        }
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'pathParams', pathParams);
        } catch (error) {
            throw new Error(`Failed to save persisted path params: ${error.message || error}`);
        }
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.queryParams || [];
        } catch (error) {
            return [];
        }
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'queryParams', queryParams);
        } catch (error) {
            throw new Error(`Failed to save persisted query params: ${error.message || error}`);
        }
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.headers || [];
        } catch (error) {
            return [];
        }
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'headers', headers);
        } catch (error) {
            throw new Error(`Failed to save persisted headers: ${error.message || error}`);
        }
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
            return data.authConfig || null;
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
            await this._updateEndpointField(collectionId, endpointId, 'authConfig', authConfig);
        } catch (error) {
            throw new Error(`Failed to save persisted auth config: ${error.message || error}`);
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.url || null;
        } catch (error) {
            return null;
        }
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'url', url);
        } catch (error) {
            throw new Error(`Failed to save persisted URL: ${error.message || error}`);
        }
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
            throw new Error(`Failed to save collection expansion states: ${error.message || error}`);
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
            throw new Error(`Failed to toggle pinned request: ${error.message || error}`);
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
        } catch (error) {
            throw new Error(`Failed to delete persisted endpoint data: ${error.message || error}`);
        }
    }

    /**
     * Retrieves the last selected request
     *
     * @async
     * @returns {Promise<Object|null>} Object with collectionId and endpointId or null
     */
    async getLastSelectedRequest() {
        try {
            const lastSelected = await this.backendAPI.store.get('lastSelectedRequest');
            return lastSelected || null;
        } catch (error) {
            return null;
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
            throw new Error(`Failed to clear last selected request: ${error.message || error}`);
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'graphqlData', data);
        } catch (error) {
            throw new Error(`Failed to save GraphQL data: ${error.message || error}`);
        }
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.graphqlData || null;
        } catch (error) {
            return null;
        }
    }

    async saveGrpcData(collectionId, endpointId, data) {
        try {
            await this._updateEndpointField(collectionId, endpointId, 'grpcData', data);
        } catch (error) {
            throw new Error(`Failed to save gRPC data: ${error.message || error}`);
        }
    }

    async getGrpcData(collectionId, endpointId) {
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.grpcData || null;
        } catch (error) {
            return null;
        }
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
        try {
            await this._updateEndpointField(collectionId, endpointId, 'responseSchema', schema);
        } catch (error) {
            throw new Error(`Failed to save response schema: ${error.message || error}`);
        }
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
        try {
            const data = await this._getEndpointData(collectionId, endpointId);
            return data.responseSchema || null;
        } catch (error) {
            return null;
        }
    }
}
