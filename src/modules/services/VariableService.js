/**
 * @fileoverview Service for managing variable business logic and template processing
 * @module services/VariableService
 */

import { ChangeEmitter } from './ChangeEmitter.js';

export class VariableService {
    /**
     * @param {VariableRepository} variableRepository
     * @param {VariableProcessor} variableProcessor
     * @param {IStatusDisplay} statusDisplay
     * @param {EnvironmentRepository} [environmentRepository=null]
     */
    constructor(variableRepository, variableProcessor, statusDisplay, environmentRepository = null) {
        this.repository = variableRepository;
        this.processor = variableProcessor;
        this.statusDisplay = statusDisplay;
        this.environmentRepository = environmentRepository;
        this._events = new ChangeEmitter();
    }

    /** @param {Function} callback */
    addChangeListener(callback) {
        this._events.add(callback);
    }

    /** @param {Function} callback */
    removeChangeListener(callback) {
        this._events.remove(callback);
    }

    /** @param {string} collectionId */
    _notifyVariablesChanged(collectionId) {
        this._events.emit({ type: 'collection-variables-changed', collectionId });
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

    /** @returns {Promise<Object>} */
    async getVariables() {
        if (this.environmentRepository) {
            return this.environmentRepository.getActiveEnvironmentVariables();
        }

        return {};
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async getVariablesForCollection(collectionId) {
        return this._reporting('Error loading variables', async () => {
            const collectionVariables = await this.repository.getVariablesForCollection(collectionId);
            let variables = { ...collectionVariables };

            if (this.environmentRepository) {
                const environmentVariables = await this.environmentRepository.getActiveEnvironmentVariables();
                variables = { ...variables, ...environmentVariables };
            }

            return variables;
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} name
     * @param {string} value
     * @returns {Promise<boolean>}
     */
    async setVariable(collectionId, name, value) {
        return this._reporting('Error saving variable', async () => {
            if (!this.processor.isValidVariableName(name)) {
                throw new Error(`Invalid variable name: ${name}. Variable names must start with a letter, digit, or underscore, followed by letters, digits, underscores, hyphens, or dots.`);
            }

            await this.repository.setVariable(collectionId, name, value);
            this._notifyVariablesChanged(collectionId);
            this.statusDisplay.update(`Variable "${name}" saved`, null);
            return true;
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} name
     * @returns {Promise<boolean>}
     */
    async deleteVariable(collectionId, name) {
        return this._reporting('Error deleting variable', async () => {
            await this.repository.deleteVariable(collectionId, name);
            this._notifyVariablesChanged(collectionId);
            this.statusDisplay.update(`Variable "${name}" deleted`, null);
            return true;
        });
    }

    /**
     * @param {string} collectionId
     * @param {Object} variables
     * @param {Array<string>} [secretKeys=[]]
     * @returns {Promise<boolean>}
     */
    async setMultipleVariables(collectionId, variables, secretKeys = []) {
        return this._reporting('Error saving variables', async () => {
            for (const name of Object.keys(variables)) {
                if (!this.processor.isValidVariableName(name)) {
                    throw new Error(`Invalid variable name: ${name}`);
                }
            }

            await this.repository.setVariablesForCollection(collectionId, variables, secretKeys);
            this._notifyVariablesChanged(collectionId);
            this.statusDisplay.update('Variables saved successfully', null);
            return true;
        });
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<{name: string, value: string, secret: boolean}>>}
     */
    async getCollectionVariableEntries(collectionId) {
        try {
            return await this.repository.getVariableEntriesForCollection(collectionId);
        } catch (error) {
            return [];
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<void>}
     */
    async cleanupCollectionVariables(collectionId) {
        try {
            await this.repository.deleteAllVariablesForCollection(collectionId);
            this._notifyVariablesChanged(collectionId);
        } catch (error) {
            console.error('Error cleaning up collection variables:', error);
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async exportVariables(collectionId) {
        return this.getVariablesForCollection(collectionId);
    }

    /**
     * @param {string} collectionId
     * @param {Object} variables
     * @param {boolean} [merge=false]
     * @returns {Promise<boolean>}
     */
    async importVariables(collectionId, variables, merge = false) {
        return this._reporting('Error importing variables', async () => {
            let finalVariables = variables;

            if (merge) {
                const existingVariables = await this.getVariablesForCollection(collectionId);
                finalVariables = { ...existingVariables, ...variables };
            }

            await this.setMultipleVariables(collectionId, finalVariables);
            return true;
        });
    }
}
