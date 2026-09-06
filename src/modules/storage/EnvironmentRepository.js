/**
 * @fileoverview Repository for managing environment data persistence
 * @module storage/EnvironmentRepository
 */

export class EnvironmentRepository {
    /**
     * @param {Object} backendAPI
     * @param {import('./SecretStore.js').SecretStore} [secretStore]
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.ENVIRONMENTS_KEY = 'environments';
        this.secretStore = secretStore;
        this._cache = null;
    }

    /**
     * @param {string} environmentId
     * @returns {string}
     */
    secretScope(environmentId) {
        return `env:${environmentId}`;
    }

    /**
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

    /** @returns {Promise<Object>} */
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
            throw new Error(`Failed to load environments: ${error.message}`, { cause: error });
        }
    }

    /** @returns {Promise<string|null>} */
    async getActiveEnvironmentId() {
        try {
            const data = await this.getAllEnvironments();
            return data.activeEnvironmentId || (data.items[0]?.id);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
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
            throw new Error(`Failed to set active environment: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object|undefined>}
     */
    async getEnvironmentById(environmentId) {
        try {
            const data = await this.getAllEnvironments();
            return data.items.find(env => env.id === environmentId);
        } catch (error) {
            return null;
        }
    }

    /** @returns {Promise<Object|null>} */
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
     * @param {string} name
     * @param {Object} [variables={}]
     * @returns {Promise<Object>}
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
            throw new Error(`Failed to create environment: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} environmentId
     * @param {Object} updates
     * @param {string} [updates.name]
     * @param {Object} [updates.variables]
     * @returns {Promise<Object>}
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
            throw new Error(`Failed to update environment: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
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
            throw new Error(`Failed to delete environment: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} environmentId
     * @param {string} [newName]
     * @returns {Promise<Object>}
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
            throw new Error(`Failed to duplicate environment: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} environmentId
     * @param {string} name
     * @param {string} value
     * @param {boolean} [isSecret=false]
     * @returns {Promise<Object>}
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
     * @param {string} environmentId
     * @param {string} name
     * @returns {Promise<Object|undefined>}
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
     * @param {string} environmentId
     * @param {string} name
     * @returns {Promise<string>}
     */
    async getEnvironmentSecretValue(environmentId, name) {
        if (!this.secretStore) {
            return '';
        }
        const value = await this.secretStore.get(this.secretScope(environmentId), name);
        return value === undefined || value === null ? '' : value;
    }

    /**
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

    /** @returns {Promise<Object>} */
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
     * @param {Object} environment
     * @returns {Promise<Object>}
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

    /** @returns {string} */
    _generateId() {
        return `env_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /** @returns {Object} */
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

    /** @returns {Promise<Object>} */
    async exportEnvironments() {
        try {
            return await this.getAllEnvironments();
        } catch (error) {
            throw new Error(`Failed to export environments: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} environmentsData
     * @param {Array<Object>} environmentsData.items
     * @param {boolean} [merge=false]
     * @returns {Promise<boolean>}
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
            throw new Error(`Failed to import environments: ${error.message}`, { cause: error });
        }
    }
}
