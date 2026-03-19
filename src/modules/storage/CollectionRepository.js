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
     * Creates a CollectionRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
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
        try {
            return await this.backendAPI.collections.get(id);
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
}
