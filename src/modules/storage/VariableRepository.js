/**
 * @fileoverview Repository for managing collection variable persistence
 * @module storage/VariableRepository
 */

/**
 * Repository for managing collection variable persistence
 *
 * @class
 * @classdesc Handles CRUD operations for collection-scoped variables using file-based storage.
 * Variables are stored per collection in a variables.json file within the collection directory.
 * This enables Git-friendly storage with clean diffs.
 *
 * @deprecated This repository is being phased out in favor of EnvironmentRepository
 * which provides environment-scoped variables with better organization.
 */
export class VariableRepository {
    /**
     * Creates a VariableRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        // Per-collection cache: Map<collectionId, variables>
        this._cache = new Map();
    }

    /**
     * Invalidates the cache for a specific collection or all collections
     *
     * @param {string} [collectionId] - Optional collection ID to invalidate. If not provided, clears entire cache.
     */
    invalidateCache(collectionId = null) {
        if (collectionId) {
            this._cache.delete(collectionId);
        } else {
            this._cache.clear();
        }
    }

    /**
     * Converts array format to object format for backward compatibility
     * @private
     */
    _arrayToObject(variables) {
        if (Array.isArray(variables)) {
            const obj = {};
            for (const v of variables) {
                if (v && v.key) {
                    obj[v.key] = v.value;
                }
            }
            return obj;
        }
        return variables || {};
    }

    /**
     * Converts object format to array format for storage
     * @private
     */
    _objectToArray(variables) {
        if (Array.isArray(variables)) {
            return variables;
        }
        return Object.entries(variables || {}).map(([key, value]) => ({ key, value }));
    }

    /**
     * Retrieves all variables for all collections
     *
     * Note: This method is less efficient with file-based storage as it needs to
     * read each collection's variables file. Prefer getVariablesForCollection when possible.
     *
     * @async
     * @returns {Promise<Object>} Object mapping collection IDs to variable objects
     * @throws {Error} If storage access fails
     */
    async getAllVariables() {
        try {
            const collectionIds = await this.backendAPI.collections.list();
            const allVariables = {};

            for (const collectionId of collectionIds) {
                const vars = await this.getVariablesForCollection(collectionId);
                if (Object.keys(vars).length > 0) {
                    allVariables[collectionId] = vars;
                }
            }

            return allVariables;
        } catch (error) {
            throw new Error(`Failed to load variables: ${error.message}`);
        }
    }

    /**
     * Retrieves variables for a specific collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Object>} Object mapping variable names to values
     * @throws {Error} If retrieval fails
     */
    async getVariablesForCollection(collectionId) {
        // Return cached value if available
        if (this._cache.has(collectionId)) {
            return this._cache.get(collectionId);
        }

        try {
            const variables = await this.backendAPI.collections.getVariables(collectionId);
            const result = this._arrayToObject(variables);
            this._cache.set(collectionId, result);
            return result;
        } catch (error) {
            return {};
        }
    }

    /**
     * Sets all variables for a specific collection
     *
     * Replaces existing variables for the collection.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {Object} variables - Object mapping variable names to values
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async setVariablesForCollection(collectionId, variables) {
        try {
            const arrayFormat = this._objectToArray(variables);
            await this.backendAPI.collections.saveVariables(collectionId, arrayFormat);
            // Update cache with the new values
            this._cache.set(collectionId, this._arrayToObject(arrayFormat));
        } catch (error) {
            // Invalidate cache on error to ensure consistency
            this._cache.delete(collectionId);
            throw new Error(`Failed to save collection variables: ${error.message}`);
        }
    }

    /**
     * Sets a single variable for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - The variable name
     * @param {*} value - The variable value
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async setVariable(collectionId, name, value) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            variables[name] = value;
            await this.setVariablesForCollection(collectionId, variables);
        } catch (error) {
            throw new Error(`Failed to set variable: ${error.message}`);
        }
    }

    /**
     * Deletes a single variable from a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - The variable name to delete
     * @returns {Promise<void>}
     * @throws {Error} If delete operation fails
     */
    async deleteVariable(collectionId, name) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            delete variables[name];
            await this.setVariablesForCollection(collectionId, variables);
        } catch (error) {
            throw new Error(`Failed to delete variable: ${error.message}`);
        }
    }

    /**
     * Deletes all variables for a collection
     *
     * Used when deleting a collection to clean up orphaned data.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<void>}
     * @throws {Error} If delete operation fails
     */
    async deleteAllVariablesForCollection(collectionId) {
        try {
            // Save empty array to clear variables for this collection
            await this.backendAPI.collections.saveVariables(collectionId, []);
        } catch {
            // Ignore errors - collection may already be deleted
        }
        // Remove from cache regardless
        this._cache.delete(collectionId);
    }

    /**
     * Retrieves a single variable value for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - The variable name
     * @returns {Promise<*>} The variable value or undefined if not found
     */
    async getVariable(collectionId, name) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return variables[name];
        } catch (error) {
            return undefined;
        }
    }
}