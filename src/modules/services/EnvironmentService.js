/**
 * @fileoverview Service for managing environment business logic with event notifications
 * @module services/EnvironmentService
 */

import { ChangeEmitter } from './ChangeEmitter.js';

/**
 * @param {{name: string, variables: Object, secretKeys?: string[], color?: string|null}} environment
 * @returns {{name: string, variables: Object, secretKeys: string[], color: string|null}}
 */
function toExportShape(environment) {
    return {
        name: environment.name,
        variables: environment.variables,
        secretKeys: Array.isArray(environment.secretKeys) ? environment.secretKeys : [],
        color: environment.color || null
    };
}

export class EnvironmentService {
    /**
     * @param {EnvironmentRepository} environmentRepository
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(environmentRepository, statusDisplay) {
        this.repository = environmentRepository;
        this.statusDisplay = statusDisplay;
        this._events = new ChangeEmitter();
    }

    /**
     * @param {string} label
     * @param {function(): Promise<*>} work
     * @returns {Promise<*>}
     */
    async _reporting(label, work) {
        try {
            return await work();
        } catch (error) {
            this.statusDisplay.update(`${label}: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object>}
     */
    async _requireEnvironment(environmentId) {
        const environment = await this.repository.getEnvironmentById(environmentId);
        if (!environment) {
            throw new Error('Environment not found');
        }
        return environment;
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
        this._events.add(callback);
    }

    /**
     * @param {Object} event
     * @returns {void}
     */
    _notifyListeners(event) {
        this._events.emit(event);
    }

    /** @returns {Promise<Array<Object>>} */
    async getAllEnvironments() {
        return this._reporting('Error loading environments', async () => {
            const data = await this.repository.getAllEnvironments();
            return data.items;
        });
    }

    /** @returns {Promise<Object|null>} */
    async getActiveEnvironment() {
        return this.repository.getActiveEnvironment();
    }

    /** @returns {Promise<string|null>} */
    async getActiveEnvironmentId() {
        return this.repository.getActiveEnvironmentId();
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object>}
     */
    async switchEnvironment(environmentId) {
        return this._reporting('Error switching environment', async () => {
            const environment = await this._requireEnvironment(environmentId);

            await this.repository.setActiveEnvironment(environmentId);

            this._notifyListeners({
                type: 'environment-switched',
                environmentId: environmentId,
                environmentName: environment.name,
                environmentColor: environment.color ?? null
            });

            return environment;
        });
    }

    /**
     * @param {string} name
     * @param {Object} [variables={}]
     * @param {string|null} [color=null]
     * @returns {Promise<Object>}
     */
    async createEnvironment(name, variables = {}, color = null) {
        return this._reporting('Error creating environment', async () => {
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
        });
    }

    /**
     * @param {string} environmentId
     * @param {Object} updates
     * @param {string} [updates.name]
     * @param {Object} [updates.variables]
     * @returns {Promise<Object>}
     */
    async updateEnvironment(environmentId, updates) {
        return this._reporting('Error updating environment', async () => {
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
        });
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
     */
    async deleteEnvironment(environmentId) {
        return this._reporting('Error deleting environment', async () => {
            const environment = await this._requireEnvironment(environmentId);

            await this.repository.deleteEnvironment(environmentId);

            this.statusDisplay.update(`Environment "${environment.name}" deleted`, null);

            this._notifyListeners({
                type: 'environment-deleted',
                environmentId: environmentId
            });

            return true;
        });
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object>}
     */
    async duplicateEnvironment(environmentId) {
        return this._reporting('Error duplicating environment', async () => {
            const environment = await this._requireEnvironment(environmentId);

            const newName = await this._generateUniqueName(`${environment.name} (Copy)`);
            const duplicatedEnvironment = await this.repository.duplicateEnvironment(environmentId, newName);

            this.statusDisplay.update(`Environment duplicated as "${newName}"`, null);

            this._notifyListeners({
                type: 'environment-created',
                environment: duplicatedEnvironment
            });

            return duplicatedEnvironment;
        });
    }

    /** @returns {Promise<Object>} */
    async getActiveEnvironmentVariables() {
        return this.repository.getActiveEnvironmentVariables();
    }

    /**
     * @param {string} environmentId
     * @param {string} name
     * @param {string} value
     * @param {boolean} [isSecret=false]
     * @returns {Promise<boolean>}
     */
    async setVariable(environmentId, name, value, isSecret = false) {
        return this._reporting('Error setting variable', async () => {
            await this.repository.setEnvironmentVariable(environmentId, name, value, isSecret);
            return true;
        });
    }

    /**
     * @param {string} environmentId
     * @param {Object} changes
     * @returns {Promise<boolean>}
     */
    async applyVariableChanges(environmentId, changes) {
        return this._reporting('Error setting variable', async () => {
            await this.repository.applyVariableChanges(environmentId, changes);
            return true;
        });
    }

    /**
     * @param {string} environmentId
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async deleteVariable(environmentId, name) {
        return this._reporting('Error deleting variable', async () => {
            await this.repository.deleteEnvironmentVariable(environmentId, name);
            return true;
        });
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

    /**
     * @param {string} environmentId
     * @returns {Promise<{name: string, variables: Object, secretKeys: string[], color: string|null}>}
     */
    async exportEnvironment(environmentId) {
        return this._reporting('Error exporting environment', async () => {
            const environment = await this._requireEnvironment(environmentId);

            return toExportShape(environment);
        });
    }

    /** @returns {Promise<{version: string, environments: Array<Object>}>} */
    async exportAllEnvironments() {
        return this._reporting('Error exporting environments', async () => {
            const data = await this.repository.exportEnvironments();
            return {
                version: '1.0',
                environments: data.items.map(toExportShape)
            };
        });
    }

    /**
     * @param {{environments: Array<Object>}} data
     * @param {boolean} [merge=false]
     * @returns {Promise<boolean>}
     */
    async importEnvironments(data, merge = false) {
        return this._reporting('Error importing environments', async () => {
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
        });
    }

    /**
     * @param {string} baseName
     * @returns {Promise<string>}
     */
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
}
