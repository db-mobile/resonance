/**
 * @fileoverview Service for managing environment business logic with event notifications
 * @module services/EnvironmentService
 */

export class EnvironmentService {
    /**
     * @param {EnvironmentRepository} environmentRepository
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(environmentRepository, statusDisplay) {
        this.repository = environmentRepository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * @param {string|null|undefined} color
     * @returns {string|null}
     */
    _normalizeColor(color) {
        if (color === null || color === undefined || color === '') {
            return null;
        }

        if (typeof color !== 'string') {
            throw new Error('Environment color must be a hex color');
        }

        const trimmed = color.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
            throw new Error('Environment color must be a 6-digit hex color');
        }

        return trimmed.toUpperCase();
    }

    /**
     * @param {Function} callback
     * @param {Object} callback.event
     * @param {string} callback.event.type
     * @returns {void}
     */
    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * @param {Function} callback
     * @returns {void}
     */
    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * @param {Object} event
     * @returns {void}
     */
    _notifyListeners(event) {
        this.listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                void error;
            }
        });
    }

    /** @returns {Promise<Array<Object>>} */
    async getAllEnvironments() {
        try {
            const data = await this.repository.getAllEnvironments();
            return data.items;
        } catch (error) {
            this.statusDisplay.update(`Error loading environments: ${error.message}`, null);
            throw error;
        }
    }

    /** @returns {Promise<Object|null>} */
    async getActiveEnvironment() {
        try {
            return await this.repository.getActiveEnvironment();
        } catch (error) {
            return null;
        }
    }

    /** @returns {Promise<string|null>} */
    async getActiveEnvironmentId() {
        try {
            return await this.repository.getActiveEnvironmentId();
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object>}
     */
    async switchEnvironment(environmentId) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            await this.repository.setActiveEnvironment(environmentId);

            this._notifyListeners({
                type: 'environment-switched',
                environmentId: environmentId,
                environmentName: environment.name,
                environmentColor: environment.color ?? null
            });

            return environment;
        } catch (error) {
            this.statusDisplay.update(`Error switching environment: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} name
     * @param {Object} [variables={}]
     * @returns {Promise<Object>}
     */
    async createEnvironment(name, variables = {}, color = null) {
        try {
            if (!name || typeof name !== 'string' || name.trim() === '') {
                throw new Error('Environment name is required');
            }

            const trimmedName = name.trim();
            const normalizedColor = this._normalizeColor(color);
            const newEnvironment = await this.repository.createEnvironment(trimmedName, variables, normalizedColor);

            this.statusDisplay.update(`Environment "${trimmedName}" created`, null);

            this._notifyListeners({
                type: 'environment-created',
                environment: newEnvironment
            });

            return newEnvironment;
        } catch (error) {
            this.statusDisplay.update(`Error creating environment: ${error.message}`, null);
            throw error;
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
            if (updates.name !== undefined) {
                if (!updates.name || typeof updates.name !== 'string' || updates.name.trim() === '') {
                    throw new Error('Environment name cannot be empty');
                }
                updates.name = updates.name.trim();
            }

            if (Object.prototype.hasOwnProperty.call(updates, 'color')) {
                updates.color = this._normalizeColor(updates.color);
            }

            const updatedEnvironment = await this.repository.updateEnvironment(environmentId, updates);

            this.statusDisplay.update('Environment updated', null);

            this._notifyListeners({
                type: 'environment-updated',
                environment: updatedEnvironment
            });

            return updatedEnvironment;
        } catch (error) {
            this.statusDisplay.update(`Error updating environment: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} environmentId
     * @param {string} newName
     * @returns {Promise<Object>}
     */
    async renameEnvironment(environmentId, newName) {
        return this.updateEnvironment(environmentId, { name: newName });
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
     */
    async deleteEnvironment(environmentId) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            await this.repository.deleteEnvironment(environmentId);

            this.statusDisplay.update(`Environment "${environment.name}" deleted`, null);

            this._notifyListeners({
                type: 'environment-deleted',
                environmentId: environmentId
            });

            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting environment: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object>}
     */
    async duplicateEnvironment(environmentId) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            const newName = await this._generateUniqueName(`${environment.name} (Copy)`);
            const duplicatedEnvironment = await this.repository.duplicateEnvironment(environmentId, newName);

            this.statusDisplay.update(`Environment duplicated as "${newName}"`, null);

            this._notifyListeners({
                type: 'environment-created',
                environment: duplicatedEnvironment
            });

            return duplicatedEnvironment;
        } catch (error) {
            this.statusDisplay.update(`Error duplicating environment: ${error.message}`, null);
            throw error;
        }
    }

    async getActiveEnvironmentVariables() {
        try {
            return await this.repository.getActiveEnvironmentVariables();
        } catch (error) {
            return {};
        }
    }

    async updateEnvironmentVariables(environmentId, variables) {
        try {
            return await this.updateEnvironment(environmentId, { variables });
        } catch (error) {
            this.statusDisplay.update(`Error updating environment variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} environmentId
     * @param {string} name
     * @param {string} value
     * @param {boolean} [isSecret=false]
     */
    async setVariable(environmentId, name, value, isSecret = false) {
        try {
            await this.repository.setEnvironmentVariable(environmentId, name, value, isSecret);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error setting variable: ${error.message}`, null);
            throw error;
        }
    }

    async deleteVariable(environmentId, name) {
        try {
            await this.repository.deleteEnvironmentVariable(environmentId, name);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting variable: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} environmentId
     * @param {string} name
     * @returns {Promise<string>}
     */
    async getSecretValue(environmentId, name) {
        try {
            return await this.repository.getEnvironmentSecretValue(environmentId, name);
        } catch (error) {
            return '';
        }
    }

    async exportEnvironment(environmentId) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            return {
                name: environment.name,
                variables: environment.variables,
                secretKeys: Array.isArray(environment.secretKeys) ? environment.secretKeys : [],
                color: environment.color || null
            };
        } catch (error) {
            this.statusDisplay.update(`Error exporting environment: ${error.message}`, null);
            throw error;
        }
    }

    async exportAllEnvironments() {
        try {
            const data = await this.repository.exportEnvironments();
            return {
                version: '1.0',
                environments: data.items.map(env => ({
                    name: env.name,
                    variables: env.variables,
                    secretKeys: Array.isArray(env.secretKeys) ? env.secretKeys : [],
                    color: env.color || null
                }))
            };
        } catch (error) {
            this.statusDisplay.update(`Error exporting environments: ${error.message}`, null);
            throw error;
        }
    }

    async importEnvironments(data, merge = false) {
        try {
            if (!data || !Array.isArray(data.environments)) {
                throw new Error('Invalid import data format');
            }

            const environmentsData = {
                items: data.environments.map(env => ({
                    id: null,
                    name: env.name || 'Imported Environment',
                    variables: env.variables || {},
                    secretKeys: Array.isArray(env.secretKeys) ? env.secretKeys : [],
                    color: this._normalizeColor(env.color)
                }))
            };

            await this.repository.importEnvironments(environmentsData, merge);

            const action = merge ? 'merged' : 'imported';
            this.statusDisplay.update(`Environments ${action} successfully`, null);

            this._notifyListeners({
                type: 'environments-imported',
                merge: merge
            });

            return true;
        } catch (error) {
            this.statusDisplay.update(`Error importing environments: ${error.message}`, null);
            throw error;
        }
    }

    async _generateUniqueName(baseName) {
        const environments = await this.getAllEnvironments();
        const existingNames = environments.map(env => env.name);

        let name = baseName;
        let counter = 1;

        while (existingNames.includes(name)) {
            name = `${baseName} ${counter}`;
            counter++;
        }

        return name;
    }

    isValidEnvironmentName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        const trimmed = name.trim();
        return trimmed.length > 0 && trimmed.length <= 100;
    }
}
