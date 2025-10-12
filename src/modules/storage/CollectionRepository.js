/**
 * Repository pattern for collection data access
 * Follows Single Responsibility Principle - only handles data persistence
 */
export class CollectionRepository {
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.COLLECTIONS_KEY = 'collections';
        this.MODIFIED_BODIES_KEY = 'modifiedRequestBodies';
    }

    async getAll() {
        try {
            return await this.electronAPI.store.get(this.COLLECTIONS_KEY) || [];
        } catch (error) {
            console.error('Error loading collections:', error);
            throw new Error(`Failed to load collections: ${error.message}`);
        }
    }

    async save(collections) {
        try {
            await this.electronAPI.store.set(this.COLLECTIONS_KEY, collections);
        } catch (error) {
            console.error('Error saving collections:', error);
            throw new Error(`Failed to save collections: ${error.message}`);
        }
    }

    async getById(id) {
        const collections = await this.getAll();
        return collections.find(collection => collection.id === id);
    }

    async add(collection) {
        const collections = await this.getAll();
        collections.push(collection);
        await this.save(collections);
        return collection;
    }

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

    async delete(id) {
        const collections = await this.getAll();
        const updatedCollections = collections.filter(collection => collection.id !== id);
        await this.save(updatedCollections);
        return true;
    }

    async getModifiedRequestBody(collectionId, endpointId) {
        try {
            const modifiedBodies = await this.electronAPI.store.get(this.MODIFIED_BODIES_KEY) || {};
            const key = `${collectionId}_${endpointId}`;
            return modifiedBodies[key] || null;
        } catch (error) {
            console.error('Error getting modified request body:', error);
            return null;
        }
    }

    async saveModifiedRequestBody(collectionId, endpointId, body) {
        try {
            const modifiedBodies = await this.electronAPI.store.get(this.MODIFIED_BODIES_KEY) || {};
            const key = `${collectionId}_${endpointId}`;
            modifiedBodies[key] = body;
            await this.electronAPI.store.set(this.MODIFIED_BODIES_KEY, modifiedBodies);
        } catch (error) {
            console.error('Error saving modified request body:', error);
            throw new Error(`Failed to save modified request body: ${error.message}`);
        }
    }

    async getPersistedQueryParams(collectionId, endpointId) {
        try {
            const persistedParams = await this.electronAPI.store.get('persistedQueryParams') || {};
            const key = `${collectionId}_${endpointId}`;
            return persistedParams[key] || [];
        } catch (error) {
            console.error('Error getting persisted query params:', error);
            return [];
        }
    }

    async savePersistedQueryParams(collectionId, endpointId, queryParams) {
        try {
            const persistedParams = await this.electronAPI.store.get('persistedQueryParams') || {};
            const key = `${collectionId}_${endpointId}`;
            persistedParams[key] = queryParams;
            await this.electronAPI.store.set('persistedQueryParams', persistedParams);
        } catch (error) {
            console.error('Error saving persisted query params:', error);
            throw new Error(`Failed to save persisted query params: ${error.message}`);
        }
    }

    async getPersistedHeaders(collectionId, endpointId) {
        try {
            const persistedHeaders = await this.electronAPI.store.get('persistedHeaders') || {};
            const key = `${collectionId}_${endpointId}`;
            return persistedHeaders[key] || [];
        } catch (error) {
            console.error('Error getting persisted headers:', error);
            return [];
        }
    }

    async savePersistedHeaders(collectionId, endpointId, headers) {
        try {
            const persistedHeaders = await this.electronAPI.store.get('persistedHeaders') || {};
            const key = `${collectionId}_${endpointId}`;
            persistedHeaders[key] = headers;
            await this.electronAPI.store.set('persistedHeaders', persistedHeaders);
        } catch (error) {
            console.error('Error saving persisted headers:', error);
            throw new Error(`Failed to save persisted headers: ${error.message}`);
        }
    }

    async getCollectionExpansionStates() {
        try {
            return await this.electronAPI.store.get('collectionExpansionStates') || {};
        } catch (error) {
            console.error('Error getting collection expansion states:', error);
            return {};
        }
    }

    async saveCollectionExpansionStates(expansionStates) {
        try {
            await this.electronAPI.store.set('collectionExpansionStates', expansionStates);
        } catch (error) {
            console.error('Error saving collection expansion states:', error);
            throw new Error(`Failed to save collection expansion states: ${error.message}`);
        }
    }

    async deletePersistedEndpointData(collectionId, endpointId) {
        try {
            const key = `${collectionId}_${endpointId}`;

            // Delete modified request body
            const modifiedBodies = await this.electronAPI.store.get(this.MODIFIED_BODIES_KEY) || {};
            if (modifiedBodies[key]) {
                delete modifiedBodies[key];
                await this.electronAPI.store.set(this.MODIFIED_BODIES_KEY, modifiedBodies);
            }

            // Delete persisted query params
            const persistedParams = await this.electronAPI.store.get('persistedQueryParams') || {};
            if (persistedParams[key]) {
                delete persistedParams[key];
                await this.electronAPI.store.set('persistedQueryParams', persistedParams);
            }

            // Delete persisted headers
            const persistedHeaders = await this.electronAPI.store.get('persistedHeaders') || {};
            if (persistedHeaders[key]) {
                delete persistedHeaders[key];
                await this.electronAPI.store.set('persistedHeaders', persistedHeaders);
            }
        } catch (error) {
            console.error('Error deleting persisted endpoint data:', error);
            throw new Error(`Failed to delete persisted endpoint data: ${error.message}`);
        }
    }
}