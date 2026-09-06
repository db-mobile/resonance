/**
 * @fileoverview Repository for managing collection variable persistence
 * @module storage/VariableRepository
 */

export class VariableRepository {
    /**
     * @param {Object} backendAPI
     * @param {import('./SecretStore.js').SecretStore} [secretStore]
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.secretStore = secretStore;
        this._cache = new Map();
    }

    /**
     * @param {string} collectionId
     * @returns {string}
     */
    secretScope(collectionId) {
        return `collvar:${collectionId}`;
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async _getRawEntries(collectionId) {
        const variables = await this.backendAPI.collections.getVariables(collectionId);
        return Array.isArray(variables) ? variables : this._objectToArray(variables);
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<string[]>}
     */
    async _getSecretKeys(collectionId) {
        const raw = await this._getRawEntries(collectionId);
        return raw.filter(e => e && e.secret && e.key).map(e => e.key);
    }

    /** @param {string} [collectionId] */
    invalidateCache(collectionId = null) {
        if (collectionId) {
            this._cache.delete(collectionId);
        } else {
            this._cache.clear();
        }
    }

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

    _objectToArray(variables) {
        if (Array.isArray(variables)) {
            return variables;
        }
        return Object.entries(variables || {}).map(([key, value]) => ({ key, value }));
    }

    /** @returns {Promise<Object>} */
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
            throw new Error(`Failed to load variables: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async getVariablesForCollection(collectionId) {
        if (this._cache.has(collectionId)) {
            return this._cache.get(collectionId);
        }

        try {
            const raw = await this._getRawEntries(collectionId);
            const result = this._arrayToObject(raw);
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
     * @param {string} collectionId
     * @param {Object} variables
     * @returns {Promise<void>}
     */
    async setVariablesForCollection(collectionId, variables, secretKeys = []) {
        try {
            const secretSet = new Set(Array.isArray(secretKeys) ? secretKeys : []);
            const scope = this.secretScope(collectionId);

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

            if (this.secretStore) {
                const stored = await this.secretStore.getScope(scope);
                for (const key of Object.keys(stored)) {
                    if (!secretSet.has(key)) {
                        await this.secretStore.delete(scope, key);
                    }
                }
            }

            await this.backendAPI.collections.saveVariables(collectionId, arrayFormat);
            this._cache.set(collectionId, { ...variables });
        } catch (error) {
            this._cache.delete(collectionId);
            throw new Error(`Failed to save collection variables: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} name
     * @param {*} value
     * @returns {Promise<void>}
     */
    async setVariable(collectionId, name, value) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            const secretKeys = await this._getSecretKeys(collectionId);
            variables[name] = value;
            await this.setVariablesForCollection(collectionId, variables, secretKeys);
        } catch (error) {
            throw new Error(`Failed to set variable: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} name
     * @returns {Promise<void>}
     */
    async deleteVariable(collectionId, name) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            const secretKeys = (await this._getSecretKeys(collectionId)).filter(k => k !== name);
            delete variables[name];
            await this.setVariablesForCollection(collectionId, variables, secretKeys);
        } catch (error) {
            throw new Error(`Failed to delete variable: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<void>}
     */
    async deleteAllVariablesForCollection(collectionId) {
        try {
            await this.backendAPI.collections.saveVariables(collectionId, []);
            if (this.secretStore) {
                await this.secretStore.deleteScope(this.secretScope(collectionId));
            }
        } catch {
        }
        this._cache.delete(collectionId);
    }

    /**
     * @param {string} collectionId
     * @param {string} name
     * @returns {Promise<*>}
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