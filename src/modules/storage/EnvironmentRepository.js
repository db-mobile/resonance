/**
 * @fileoverview Repository for managing environment data persistence
 * @module storage/EnvironmentRepository
 */

/**
 * Repository for managing environment data persistence
 *
 * @class
 * @classdesc Handles CRUD operations for environments and active environment tracking
 * in the persistent store. Environments provide variable scoping for different contexts
 * (Development, Staging, Production, etc.). Implements defensive programming with
 * validation, auto-initialization, and duplicate name detection. Ensures at least
 * one environment always exists and is active.
 */
export class EnvironmentRepository {
    /**
     * Creates an EnvironmentRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     * @param {import('./SecretStore.js').SecretStore} [secretStore] - Optional secret
     *   backend; when provided, variables flagged in `secretKeys` are stored out of band
     *   and hydrated at resolution time instead of living in the plaintext store.
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.ENVIRONMENTS_KEY = 'environments';
        this.secretStore = secretStore;
        this._cache = null;
    }

    /**
     * Builds the SecretStore scope string for an environment.
     *
     * @param {string} environmentId
     * @returns {string}
     */
    secretScope(environmentId) {
        return `env:${environmentId}`;
    }

    /**
     * Normalize environment shape for backward compatibility.
     *
     * @private
     * @param {Object} environment
     * @returns {Object}
     */
    _normalizeEnvironment(environment) {
        const variables = environment?.variables && typeof environment.variables === 'object' ? environment.variables : {};
        return {
            id: environment?.id,
            name: environment?.name || 'Environment',
            variables: variables,
            secretKeys: this._normalizeSecretKeys(environment?.secretKeys, variables),
            color: this._normalizeColor(environment?.color)
        };
    }

    /**
     * Normalize the list of variable names flagged as secret.
     *
     * Keeps only names that still correspond to a defined variable and removes
     * duplicates, so the secret flag can never reference a deleted variable.
     *
     * @private
     * @param {Array<string>|undefined} secretKeys
     * @param {Object} variables
     * @returns {Array<string>}
     */
    _normalizeSecretKeys(secretKeys, variables) {
        if (!Array.isArray(secretKeys)) {
            return [];
        }
        const known = new Set(Object.keys(variables || {}));
        return [...new Set(secretKeys.filter(name => typeof name === 'string' && known.has(name)))];
    }

    /**
     * Normalize stored color values.
     *
     * @private
     * @param {string|null|undefined} color
     * @returns {string|null}
     */
    _normalizeColor(color) {
        if (typeof color !== 'string') {
            return null;
        }

        const trimmed = color.trim();
        return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null;
    }

    /**
     * Retrieves all environments with validation and initialization
     *
     * Automatically initializes storage with default environment if undefined
     * (packaged app first run). Validates structure and ensures items array exists.
     *
     * @async
     * @returns {Promise<Object>} Object containing items array and activeEnvironmentId
     * @returns {Promise<Object>} return.items - Array of environment objects
     * @returns {Promise<string|null>} return.activeEnvironmentId - ID of active environment
     * @throws {Error} If storage access fails
     */
    async getAllEnvironments() {
        if (this._cache !== null) {
            return this._cache;
        }

        try {
            const data = await this.backendAPI.store.get(this.ENVIRONMENTS_KEY);

            if (!data || typeof data !== 'object') {
                const defaultData = this._getDefaultEnvironments();
                await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, defaultData);
                this._cache = defaultData;
                return defaultData;
            }

            if (!Array.isArray(data.items)) {
                const defaultData = this._getDefaultEnvironments();
                await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, defaultData);
                this._cache = defaultData;
                return defaultData;
            }

            const normalizedData = {
                ...data,
                items: data.items.map(env => this._normalizeEnvironment(env))
            };

            const changed = JSON.stringify(normalizedData) !== JSON.stringify(data);
            if (changed) {
                await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, normalizedData);
            }

            this._cache = normalizedData;
            return normalizedData;
        } catch (error) {
            throw new Error(`Failed to load environments: ${error.message}`);
        }
    }

    /**
     * Retrieves the active environment ID
     *
     * Falls back to first environment ID if no active environment is set.
     *
     * @async
     * @returns {Promise<string|null>} The active environment ID or null
     */
    async getActiveEnvironmentId() {
        try {
            const data = await this.getAllEnvironments();
            return data.activeEnvironmentId || (data.items[0]?.id);
        } catch (error) {
            return null;
        }
    }

    /**
     * Sets the active environment
     *
     * Validates that the environment exists before setting it as active.
     *
     * @async
     * @param {string} environmentId - The environment ID to activate
     * @returns {Promise<boolean>} True if activation succeeded
     * @throws {Error} If environment not found or save fails
     */
    async setActiveEnvironment(environmentId) {
        try {
            const data = await this.getAllEnvironments();

            const exists = data.items.some(env => env.id === environmentId);
            if (!exists) {
                throw new Error(`Environment with ID ${environmentId} not found`);
            }

            data.activeEnvironmentId = environmentId;
            this.backendAPI.store.set(this.ENVIRONMENTS_KEY, data).catch(() => { });
            return true;
        } catch (error) {
            throw new Error(`Failed to set active environment: ${error.message}`);
        }
    }

    /**
     * Retrieves an environment by ID
     *
     * @async
     * @param {string} environmentId - The environment ID
     * @returns {Promise<Object|undefined>} The environment object or undefined if not found
     */
    async getEnvironmentById(environmentId) {
        try {
            const data = await this.getAllEnvironments();
            return data.items.find(env => env.id === environmentId);
        } catch (error) {
            return null;
        }
    }

    /**
     * Retrieves the active environment
     *
     * @async
     * @returns {Promise<Object|null>} The active environment object or null
     */
    async getActiveEnvironment() {
        try {
            const activeId = await this.getActiveEnvironmentId();
            if (!activeId) {return null;}
            return await this.getEnvironmentById(activeId);
        } catch (error) {
            return null;
        }
    }

    /**
     * Creates a new environment
     *
     * Validates that environment name is unique before creating.
     *
     * @async
     * @param {string} name - The environment name
     * @param {Object} [variables={}] - Initial variables object
     * @returns {Promise<Object>} The created environment object
     * @throws {Error} If name already exists or save fails
     */
    async createEnvironment(name, variables = {}, color = null) {
        try {
            const data = await this.getAllEnvironments();

            const nameExists = data.items.some(env => env.name === name);
            if (nameExists) {
                throw new Error(`Environment with name "${name}" already exists`);
            }

            const newEnvironment = {
                id: this._generateId(),
                name: name,
                variables: variables,
                color: this._normalizeColor(color)
            };

            data.items.push(newEnvironment);
            await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, data);

            return newEnvironment;
        } catch (error) {
            throw new Error(`Failed to create environment: ${error.message}`);
        }
    }

    /**
     * Updates an existing environment
     *
     * Validates name uniqueness if name is being updated. Preserves environment ID.
     *
     * @async
     * @param {string} environmentId - The environment ID to update
     * @param {Object} updates - Object with properties to update
     * @param {string} [updates.name] - New environment name
     * @param {Object} [updates.variables] - Updated variables object
     * @returns {Promise<Object>} The updated environment object
     * @throws {Error} If environment not found, name conflict, or save fails
     */
    async updateEnvironment(environmentId, updates) {
        try {
            const data = await this.getAllEnvironments();
            const index = data.items.findIndex(env => env.id === environmentId);

            if (index === -1) {
                throw new Error(`Environment with ID ${environmentId} not found`);
            }

            if (updates.name && updates.name !== data.items[index].name) {
                const nameExists = data.items.some(env => env.name === updates.name);
                if (nameExists) {
                    throw new Error(`Environment with name "${updates.name}" already exists`);
                }
            }

            data.items[index] = this._normalizeEnvironment({
                ...data.items[index],
                ...updates,
                id: environmentId
            });

            await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return data.items[index];
        } catch (error) {
            throw new Error(`Failed to update environment: ${error.message}`);
        }
    }

    /**
     * Deletes an environment
     *
     * Prevents deletion of the last environment. If deleting active environment,
     * automatically sets first remaining environment as active.
     *
     * @async
     * @param {string} environmentId - The environment ID to delete
     * @returns {Promise<boolean>} True if deletion succeeded
     * @throws {Error} If last environment, not found, or save fails
     */
    async deleteEnvironment(environmentId) {
        try {
            const data = await this.getAllEnvironments();

            if (data.items.length <= 1) {
                throw new Error('Cannot delete the last environment');
            }

            const index = data.items.findIndex(env => env.id === environmentId);
            if (index === -1) {
                throw new Error(`Environment with ID ${environmentId} not found`);
            }

            data.items.splice(index, 1);

            if (data.activeEnvironmentId === environmentId) {
                data.activeEnvironmentId = data.items[0].id;
            }

            if (this.secretStore) {
                await this.secretStore.deleteScope(this.secretScope(environmentId));
            }

            await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return true;
        } catch (error) {
            throw new Error(`Failed to delete environment: ${error.message}`);
        }
    }

    /**
     * Duplicates an environment with a new name
     *
     * Creates a copy of the environment with all its variables.
     *
     * @async
     * @param {string} environmentId - The environment ID to duplicate
     * @param {string} [newName] - Name for the duplicated environment (defaults to "Name (Copy)")
     * @returns {Promise<Object>} The created duplicate environment object
     * @throws {Error} If source environment not found or creation fails
     */
    async duplicateEnvironment(environmentId, newName) {
        try {
            const environment = await this.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error(`Environment with ID ${environmentId} not found`);
            }

            const duplicate = await this.createEnvironment(
                newName || `${environment.name} (Copy)`,
                { ...environment.variables },
                environment.color
            );

            const secretKeys = Array.isArray(environment.secretKeys) ? environment.secretKeys : [];
            if (secretKeys.length === 0) {
                return duplicate;
            }

            await this._copySecretScope(environmentId, duplicate.id, secretKeys);
            await this.updateEnvironment(duplicate.id, { secretKeys: [...secretKeys] });
            return await this.getEnvironmentById(duplicate.id);
        } catch (error) {
            throw new Error(`Failed to duplicate environment: ${error.message}`);
        }
    }

    /**
     * Creates or updates a single variable, honoring its secret flag.
     *
     * Secret variables keep an empty placeholder in the persisted `variables` map and
     * store their real value in the SecretStore, so the value never lands in the
     * plaintext store, exports, or git-friendly collection files. Non-secret variables
     * store their value inline and drop any prior secret copy.
     *
     * @async
     * @param {string} environmentId
     * @param {string} name
     * @param {string} value
     * @param {boolean} [isSecret=false]
     * @returns {Promise<Object>} The updated environment
     * @throws {Error} If the environment is not found
     */
    async setEnvironmentVariable(environmentId, name, value, isSecret = false) {
        const env = await this.getEnvironmentById(environmentId);
        if (!env) {
            throw new Error(`Environment with ID ${environmentId} not found`);
        }

        const variables = { ...env.variables };
        let secretKeys = Array.isArray(env.secretKeys) ? [...env.secretKeys] : [];

        if (isSecret) {
            if (this.secretStore) {
                await this.secretStore.set(this.secretScope(environmentId), name, value);
            }
            variables[name] = '';
            if (!secretKeys.includes(name)) {
                secretKeys.push(name);
            }
        } else {
            if (this.secretStore) {
                await this.secretStore.delete(this.secretScope(environmentId), name);
            }
            variables[name] = value;
            secretKeys = secretKeys.filter(n => n !== name);
        }

        return this.updateEnvironment(environmentId, { variables, secretKeys });
    }

    /**
     * Deletes a single variable and any secret value behind it.
     *
     * @async
     * @param {string} environmentId
     * @param {string} name
     * @returns {Promise<Object|undefined>} The updated environment, or undefined if not found
     */
    async deleteEnvironmentVariable(environmentId, name) {
        const env = await this.getEnvironmentById(environmentId);
        if (!env) {
            return undefined;
        }

        const variables = { ...env.variables };
        delete variables[name];
        const secretKeys = (Array.isArray(env.secretKeys) ? env.secretKeys : []).filter(n => n !== name);

        if (this.secretStore) {
            await this.secretStore.delete(this.secretScope(environmentId), name);
        }

        return this.updateEnvironment(environmentId, { variables, secretKeys });
    }

    /**
     * Retrieves the stored secret value for a variable, for in-editor display.
     *
     * @async
     * @param {string} environmentId
     * @param {string} name
     * @returns {Promise<string>} The secret value, or '' if none/unavailable
     */
    async getEnvironmentSecretValue(environmentId, name) {
        if (!this.secretStore) {
            return '';
        }
        const value = await this.secretStore.get(this.secretScope(environmentId), name);
        return value === undefined || value === null ? '' : value;
    }

    /**
     * Copies secret values from one environment scope to another.
     *
     * @private
     * @param {string} fromId
     * @param {string} toId
     * @param {Array<string>} secretKeys
     * @returns {Promise<void>}
     */
    async _copySecretScope(fromId, toId, secretKeys) {
        if (!this.secretStore) {
            return;
        }
        const secrets = await this.secretStore.getScope(this.secretScope(fromId));
        for (const name of secretKeys) {
            if (Object.prototype.hasOwnProperty.call(secrets, name)) {
                await this.secretStore.set(this.secretScope(toId), name, secrets[name]);
            }
        }
    }

    /**
     * Retrieves variables for the active environment
     *
     * Convenience method for accessing current environment variables.
     *
     * @async
     * @returns {Promise<Object>} Object mapping variable names to values, or empty object
     */
    async getActiveEnvironmentVariables() {
        try {
            const activeEnv = await this.getActiveEnvironment();
            if (!activeEnv) {
                return {};
            }
            return await this._hydrateSecrets(activeEnv);
        } catch (error) {
            return {};
        }
    }

    /**
     * Returns an environment's variable map with secret values merged back in from
     * the SecretStore. The stored `variables` map holds empty placeholders for secret
     * keys; this resolves them for request building, the runner, and scripts.
     *
     * Used only on resolution paths — never on the editor read paths
     * (`getAllEnvironments`/`getEnvironmentById`) which must stay masked.
     *
     * @private
     * @param {Object} environment
     * @returns {Promise<Object>} Variable map with secrets resolved
     */
    async _hydrateSecrets(environment) {
        const variables = { ...(environment.variables || {}) };
        const secretKeys = Array.isArray(environment.secretKeys) ? environment.secretKeys : [];
        if (!this.secretStore || secretKeys.length === 0) {
            return variables;
        }

        const secrets = await this.secretStore.getScope(this.secretScope(environment.id));
        for (const name of secretKeys) {
            if (Object.prototype.hasOwnProperty.call(secrets, name)) {
                variables[name] = secrets[name];
            }
        }
        return variables;
    }

    /**
     * Generates a unique environment ID
     *
     * @private
     * @returns {string} Unique environment ID
     */
    _generateId() {
        return `env_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Creates the default environments structure
     *
     * @private
     * @returns {Object} Default environments object with one environment
     */
    _getDefaultEnvironments() {
        const defaultEnvId = this._generateId();
        return {
            items: [
                {
                    id: defaultEnvId,
                    name: 'Default',
                    variables: {},
                    color: null
                }
            ],
            activeEnvironmentId: defaultEnvId
        };
    }

    /**
     * Exports all environments for backup or sharing
     *
     * @async
     * @returns {Promise<Object>} Complete environments data structure
     * @throws {Error} If export fails
     */
    async exportEnvironments() {
        try {
            return await this.getAllEnvironments();
        } catch (error) {
            throw new Error(`Failed to export environments: ${error.message}`);
        }
    }

    /**
     * Imports environments from backup or shared data
     *
     * Supports both merge and replace modes. In merge mode, adds new environments
     * without duplicating names. In replace mode, completely replaces all environments.
     * New IDs are generated for all imported environments.
     *
     * @async
     * @param {Object} environmentsData - Environments data to import
     * @param {Array<Object>} environmentsData.items - Array of environment objects
     * @param {boolean} [merge=false] - If true, merge with existing; if false, replace all
     * @returns {Promise<boolean>} True if import succeeded
     * @throws {Error} If data format invalid or save fails
     */
    async importEnvironments(environmentsData, merge = false) {
        try {
            if (!environmentsData || !Array.isArray(environmentsData.items)) {
                throw new Error('Invalid environments data format');
            }

            let data;
            if (merge) {
                data = await this.getAllEnvironments();
                environmentsData.items.forEach(importedEnv => {
                    const exists = data.items.some(env => env.name === importedEnv.name);
                    if (!exists) {
                        data.items.push(this._normalizeEnvironment({
                            ...importedEnv,
                            id: this._generateId()
                        }));
                    }
                });
            } else {
                data = {
                    items: environmentsData.items.map(env => this._normalizeEnvironment({
                        ...env,
                        id: this._generateId()
                    })),
                    activeEnvironmentId: null
                };
                if (data.items.length > 0) {
                    data.activeEnvironmentId = data.items[0].id;
                }
            }

            this._cache = data;
            await this.backendAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return true;
        } catch (error) {
            throw new Error(`Failed to import environments: ${error.message}`);
        }
    }
}
