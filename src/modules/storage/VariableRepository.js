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
 */
export class VariableRepository {
    /**
     * Creates a VariableRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     * @param {import('./SecretStore.js').SecretStore} [secretStore] - Optional secret
     *   backend; when provided, variables flagged secret keep an empty placeholder in the
     *   git-friendly variables.json and store their value out of band.
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.secretStore = secretStore;
        // Per-collection cache: Map<collectionId, variables>
        this._cache = new Map();
    }

    /**
     * Builds the SecretStore scope string for a collection's variables.
     *
     * @param {string} collectionId
     * @returns {string}
     */
    secretScope(collectionId) {
        return `collvar:${collectionId}`;
    }

    /**
     * Reads the raw on-disk variable entries (array of `{ key, value, secret? }`).
     *
     * @private
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async _getRawEntries(collectionId) {
        const variables = await this.backendAPI.collections.getVariables(collectionId);
        return Array.isArray(variables) ? variables : this._objectToArray(variables);
    }

    /**
     * Returns the names of variables currently flagged secret for a collection.
     *
     * @private
     * @param {string} collectionId
     * @returns {Promise<string[]>}
     */
    async _getSecretKeys(collectionId) {
        const raw = await this._getRawEntries(collectionId);
        return raw.filter(e => e && e.secret && e.key).map(e => e.key);
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
            const raw = await this._getRawEntries(collectionId);
            const result = this._arrayToObject(raw);
            // Secret values are kept out of the variables.json file; merge them back so
            // {{ collectionVar }} resolves at request time.
            if (this.secretStore) {
                const secrets = await this.secretStore.getScope(this.secretScope(collectionId));
                for (const entry of raw) {
                    if (entry && entry.secret && entry.key && Object.prototype.hasOwnProperty.call(secrets, entry.key)) {
                        result[entry.key] = secrets[entry.key];
                    }
                }
            }
            this._cache.set(collectionId, result);
            return result;
        } catch (error) {
            return {};
        }
    }

    /**
     * Returns the collection's variables as editor entries with their secret flag and
     * resolved (unmasked) values, for the variable manager UI.
     *
     * @async
     * @param {string} collectionId
     * @returns {Promise<Array<{name: string, value: string, secret: boolean}>>}
     */
    async getVariableEntriesForCollection(collectionId) {
        try {
            const raw = await this._getRawEntries(collectionId);
            const secrets = this.secretStore
                ? await this.secretStore.getScope(this.secretScope(collectionId))
                : {};
            return raw
                .filter(e => e && e.key)
                .map(e => ({
                    name: e.key,
                    secret: Boolean(e.secret),
                    value: e.secret && Object.prototype.hasOwnProperty.call(secrets, e.key)
                        ? secrets[e.key]
                        : (e.value ?? '')
                }));
        } catch (error) {
            return [];
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
    async setVariablesForCollection(collectionId, variables, secretKeys = []) {
        try {
            const secretSet = new Set(Array.isArray(secretKeys) ? secretKeys : []);
            const scope = this.secretScope(collectionId);

            // Build the on-disk array, routing secret values out of band and leaving an
            // empty placeholder so the variables.json file stays git-friendly.
            const arrayFormat = [];
            for (const [key, value] of Object.entries(variables || {})) {
                if (secretSet.has(key)) {
                    if (this.secretStore) {
                        await this.secretStore.set(scope, key, value);
                    }
                    arrayFormat.push({ key, value: '', secret: true });
                } else {
                    arrayFormat.push({ key, value });
                }
            }

            // Prune stored secrets that are no longer flagged secret (removed or unmarked).
            if (this.secretStore) {
                const stored = await this.secretStore.getScope(scope);
                for (const key of Object.keys(stored)) {
                    if (!secretSet.has(key)) {
                        await this.secretStore.delete(scope, key);
                    }
                }
            }

            await this.backendAPI.collections.saveVariables(collectionId, arrayFormat);
            // Cache holds resolved (real) values for request-time resolution
            this._cache.set(collectionId, { ...variables });
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
            const secretKeys = await this._getSecretKeys(collectionId);
            variables[name] = value;
            await this.setVariablesForCollection(collectionId, variables, secretKeys);
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
            const secretKeys = (await this._getSecretKeys(collectionId)).filter(k => k !== name);
            delete variables[name];
            await this.setVariablesForCollection(collectionId, variables, secretKeys);
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
            if (this.secretStore) {
                await this.secretStore.deleteScope(this.secretScope(collectionId));
            }
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