/**
 * @fileoverview Repository for managing collection data persistence
 * @module storage/CollectionRepository
 */

/**
 * Repository for managing collection data persistence
 *
 * @class
 * @classdesc Handles all CRUD operations for collections in electron-store.
 * Implements defensive programming with auto-initialization and validation
 * to ensure reliable operation in both development and packaged environments.
 * Also manages endpoint-specific data such as request bodies, headers, query
 * parameters, authentication configs, and UI state.
 */
export class CollectionRepository {
    /**
     * Creates a CollectionRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge from preload script
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.COLLECTIONS_KEY = 'collections';
        this.MODIFIED_BODIES_KEY = 'modifiedRequestBodies';
    }

    /**
     * Safely retrieves an object from electron-store with fallback handling
     *
     * Implements defensive programming to handle packaged app environments where
     * store may return undefined on first run. Automatically initializes with
     * default value if data is invalid or missing.
     *
     * @private
     * @async
     * @param {string} key - The store key to retrieve
     * @param {Object} [defaultValue={}] - Default value to use if data is invalid
     * @returns {Promise<Object>} The stored object or default value
     */
    async _getObjectFromStore(key, defaultValue = {}) {
        try {
            let data = await this.electronAPI.store.get(key);

            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                console.warn(`Store data for key "${key}" is invalid or undefined, initializing with default value`);
                data = defaultValue;
                await this.electronAPI.store.set(key, data);
            }

            return data;
        } catch (error) {
            console.error(`Error getting data from store for key "${key}":`, error);
            return defaultValue;
        }
    }

    /**
     * Retrieves all collections from storage
     *
     * Automatically initializes storage with empty array if undefined (packaged app first run).
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects
     * @throws {Error} If storage access fails
     */
    async getAll() {
        try {
            const collections = await this.electronAPI.store.get(this.COLLECTIONS_KEY);

            if (!Array.isArray(collections)) {
                console.warn('Collections data is invalid or undefined, initializing with empty array');
                await this.electronAPI.store.set(this.COLLECTIONS_KEY, []);
                return [];
            }

            return collections;
        } catch (error) {
            console.error('Error loading collections:', error);
            throw new Error(`Failed to load collections: ${error.message}`);
        }
    }

    /**
     * Saves collections array to storage
     *
     * @async
     * @param {Array<Object>} collections - Array of collection objects to save
     * @returns {Promise<void>}
     * @throws {Error} If storage write fails
     */
    async save(collections) {
        try {
            await this.electronAPI.store.set(this.COLLECTIONS_KEY, collections);
        } catch (error) {
            console.error('Error saving collections:', error);
            throw new Error(`Failed to save collections: ${error.message}`);
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
        const collections = await this.getAll();
        return collections.find(collection => collection.id === id);
    }

    /**
     * Adds a new collection to storage
     *
     * Includes defensive validation to ensure collections array integrity.
     *
     * @async
     * @param {Object} collection - The collection object to add
     * @returns {Promise<Object>} The added collection object
     * @throws {Error} If save operation fails
     */
    async add(collection) {
        let collections = await this.getAll();

        if (!Array.isArray(collections)) {
            console.warn('Collections is not an array in add(), reinitializing');
            collections = [];
        }

        collections.push(collection);
        await this.save(collections);
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
        const collections = await this.getAll();
        const index = collections.findIndex(collection => collection.id === id);

        if (index === -1) {
            throw new Error(`Collection with id ${id} not found`);
        }

        collections[index] = { ...collections[index], ...updatedCollection };
        await this.save(collections);
        return collections[index];
    }

    /**
     * Deletes a collection by ID
     *
     * @async
     * @param {string} id - The collection ID to delete
     * @returns {Promise<boolean>} True if deletion succeeded
     * @throws {Error} If save operation fails
     */
    async delete(id) {
        const collections = await this.getAll();
        const updatedCollections = collections.filter(collection => collection.id !== id);
        await this.save(updatedCollections);
        return true;
    }

    /**
     * Retrieves modified request body for a specific endpoint
     *
     * Returns the user-modified request body for an endpoint, allowing customization
     * of request bodies beyond the OpenAPI schema defaults.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<string|null>} The modified request body or null if not found
     */
    async getModifiedRequestBody(collectionId, endpointId) {
        try {
            const modifiedBodies = await this._getObjectFromStore(this.MODIFIED_BODIES_KEY);
            const key = `${collectionId}_${endpointId}`;
            return modifiedBodies[key] || null;
        } catch (error) {
            console.error('Error getting modified request body:', error);
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
            const modifiedBodies = await this._getObjectFromStore(this.MODIFIED_BODIES_KEY);
            const key = `${collectionId}_${endpointId}`;
            modifiedBodies[key] = body;
            await this.electronAPI.store.set(this.MODIFIED_BODIES_KEY, modifiedBodies);
        } catch (error) {
            console.error('Error saving modified request body:', error);
            throw new Error(`Failed to save modified request body: ${error.message}`);
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
            const persistedParams = await this._getObjectFromStore('persistedPathParams');
            const key = `${collectionId}_${endpointId}`;
            return persistedParams[key] || [];
        } catch (error) {
            console.error('Error getting persisted path params:', error);
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
            const persistedParams = await this._getObjectFromStore('persistedPathParams');
            const key = `${collectionId}_${endpointId}`;
            persistedParams[key] = pathParams;
            await this.electronAPI.store.set('persistedPathParams', persistedParams);
        } catch (error) {
            console.error('Error saving persisted path params:', error);
            throw new Error(`Failed to save persisted path params: ${error.message}`);
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
            const persistedParams = await this._getObjectFromStore('persistedQueryParams');
            const key = `${collectionId}_${endpointId}`;
            return persistedParams[key] || [];
        } catch (error) {
            console.error('Error getting persisted query params:', error);
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
            const persistedParams = await this._getObjectFromStore('persistedQueryParams');
            const key = `${collectionId}_${endpointId}`;
            persistedParams[key] = queryParams;
            await this.electronAPI.store.set('persistedQueryParams', persistedParams);
        } catch (error) {
            console.error('Error saving persisted query params:', error);
            throw new Error(`Failed to save persisted query params: ${error.message}`);
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
            const persistedHeaders = await this._getObjectFromStore('persistedHeaders');
            const key = `${collectionId}_${endpointId}`;
            return persistedHeaders[key] || [];
        } catch (error) {
            console.error('Error getting persisted headers:', error);
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
            const persistedHeaders = await this._getObjectFromStore('persistedHeaders');
            const key = `${collectionId}_${endpointId}`;
            persistedHeaders[key] = headers;
            await this.electronAPI.store.set('persistedHeaders', persistedHeaders);
        } catch (error) {
            console.error('Error saving persisted headers:', error);
            throw new Error(`Failed to save persisted headers: ${error.message}`);
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
            const persistedAuthConfigs = await this._getObjectFromStore('persistedAuthConfigs');
            const key = `${collectionId}_${endpointId}`;
            return persistedAuthConfigs[key] || null;
        } catch (error) {
            console.error('Error getting persisted auth config:', error);
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
            const persistedAuthConfigs = await this._getObjectFromStore('persistedAuthConfigs');
            const key = `${collectionId}_${endpointId}`;
            persistedAuthConfigs[key] = authConfig;
            await this.electronAPI.store.set('persistedAuthConfigs', persistedAuthConfigs);
        } catch (error) {
            console.error('Error saving persisted auth config:', error);
            throw new Error(`Failed to save persisted auth config: ${error.message}`);
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
            const persistedUrls = await this._getObjectFromStore('persistedUrls');
            const key = `${collectionId}_${endpointId}`;
            return persistedUrls[key] || null;
        } catch (error) {
            console.error('Error getting persisted URL:', error);
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
            const persistedUrls = await this._getObjectFromStore('persistedUrls');
            const key = `${collectionId}_${endpointId}`;
            persistedUrls[key] = url;
            await this.electronAPI.store.set('persistedUrls', persistedUrls);
        } catch (error) {
            console.error('Error saving persisted URL:', error);
            throw new Error(`Failed to save persisted URL: ${error.message}`);
        }
    }

    /**
     * Retrieves collection expansion states for UI
     *
     * Returns which collections and endpoints are expanded/collapsed in the tree view.
     *
     * @async
     * @returns {Promise<Object>} Object mapping collection IDs to expansion state
     */
    async getCollectionExpansionStates() {
        try {
            return await this._getObjectFromStore('collectionExpansionStates');
        } catch (error) {
            console.error('Error getting collection expansion states:', error);
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
            await this.electronAPI.store.set('collectionExpansionStates', expansionStates);
        } catch (error) {
            console.error('Error saving collection expansion states:', error);
            throw new Error(`Failed to save collection expansion states: ${error.message}`);
        }
    }

    /**
     * Deletes all persisted data for a specific endpoint
     *
     * Removes modified bodies, query params, headers, and auth configs.
     * Used when deleting an endpoint or collection to clean up orphaned data.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     * @throws {Error} If delete operation fails
     */
    async deletePersistedEndpointData(collectionId, endpointId) {
        try {
            const key = `${collectionId}_${endpointId}`;

            const modifiedBodies = await this._getObjectFromStore(this.MODIFIED_BODIES_KEY);
            if (modifiedBodies[key]) {
                delete modifiedBodies[key];
                await this.electronAPI.store.set(this.MODIFIED_BODIES_KEY, modifiedBodies);
            }

            const persistedParams = await this._getObjectFromStore('persistedQueryParams');
            if (persistedParams[key]) {
                delete persistedParams[key];
                await this.electronAPI.store.set('persistedQueryParams', persistedParams);
            }

            const persistedHeaders = await this._getObjectFromStore('persistedHeaders');
            if (persistedHeaders[key]) {
                delete persistedHeaders[key];
                await this.electronAPI.store.set('persistedHeaders', persistedHeaders);
            }

            const persistedAuthConfigs = await this._getObjectFromStore('persistedAuthConfigs');
            if (persistedAuthConfigs[key]) {
                delete persistedAuthConfigs[key];
                await this.electronAPI.store.set('persistedAuthConfigs', persistedAuthConfigs);
            }
        } catch (error) {
            console.error('Error deleting persisted endpoint data:', error);
            throw new Error(`Failed to delete persisted endpoint data: ${error.message}`);
        }
    }

    /**
     * Retrieves the last selected request
     *
     * Used to restore UI state on app startup.
     *
     * @async
     * @returns {Promise<Object|null>} Object with collectionId and endpointId or null
     */
    async getLastSelectedRequest() {
        try {
            const lastSelected = await this.electronAPI.store.get('lastSelectedRequest');
            return lastSelected || null;
        } catch (error) {
            console.error('Error getting last selected request:', error);
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
            await this.electronAPI.store.set('lastSelectedRequest', {
                collectionId,
                endpointId
            });
        } catch (error) {
            console.error('Error saving last selected request:', error);
            throw new Error(`Failed to save last selected request: ${error.message}`);
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
            await this.electronAPI.store.set('lastSelectedRequest', null);
        } catch (error) {
            console.error('Error clearing last selected request:', error);
            throw new Error(`Failed to clear last selected request: ${error.message}`);
        }
    }
}