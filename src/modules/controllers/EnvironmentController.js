/**
 * @fileoverview Controller for coordinating environment operations between UI and services
 * @module controllers/EnvironmentController
 */

import { app } from '../appContext.js';
import { toast } from '../ui/Toast.js';

export class EnvironmentController {
    /**
     * @param {EnvironmentService} environmentService
     * @param {EnvironmentManager} environmentManager
     * @param {EnvironmentSelector} environmentSelector
     */
    constructor(environmentService, environmentManager, environmentSelector) {
        this.service = environmentService;
        this.manager = environmentManager;
        this.selector = environmentSelector;
    }

    /** @returns {Promise<void>} */
    async initialize() {
        this.service.addChangeListener((event) => {
            this.handleEnvironmentChange(event);
        });

        await this.loadActiveEnvironment();
    }

    /** @returns {Promise<void>} */
    async loadActiveEnvironment() {
        try {
            const activeEnvironment = await this.service.getActiveEnvironment();
            if (activeEnvironment) {
                this.selector.setActiveEnvironment(activeEnvironment);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {Object} event
     * @param {string} event.type
     * @returns {void}
     */
    handleEnvironmentChange(event) {
        switch (event.type) {
            case 'environment-switched':
                this.onEnvironmentSwitched(event);
                break;
            case 'environment-created':
            case 'environment-updated':
            case 'environment-deleted':
            case 'environments-imported':
                this.onEnvironmentsChanged();
                break;
        }
    }

    /**
     * @param {Object} _event
     * @returns {Promise<void>}
     */
    async onEnvironmentSwitched(_event) {
        try {
            app.invalidateApiHandlerEnvironmentCache?.();
            const environment = await this.service.getActiveEnvironment();
            if (environment) {
                this.selector.setActiveEnvironment(environment);
            }
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async onEnvironmentsChanged() {
        try {
            app.invalidateApiHandlerEnvironmentCache?.();
            const activeEnvironment = await this.service.getActiveEnvironment();
            if (activeEnvironment) {
                this.selector.setActiveEnvironment(activeEnvironment);
            }
            await this.selector.refresh();
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
     */
    async switchEnvironment(environmentId) {
        try {
            await this.service.switchEnvironment(environmentId);
            return true;
        } catch (error) {
            return false;
        }
    }

    /** @returns {Promise<void>} */
    async openEnvironmentManager() {
        try {
            const result = await this.manager.show();
            if (result) {
                await this.onEnvironmentsChanged();
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {string} name
     * @param {Object} [variables={}]
     * @returns {Promise<Object>}
     */
    async createEnvironment(name, variables = {}) {
        const environment = await this.service.createEnvironment(name, variables);
        return environment;
    }

    /**
     * @param {string} environmentId
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateEnvironment(environmentId, updates) {
        return this.service.updateEnvironment(environmentId, updates);
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
     */
    async deleteEnvironment(environmentId) {
        return this.service.deleteEnvironment(environmentId);
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<Object>}
     */
    async duplicateEnvironment(environmentId) {
        return this.service.duplicateEnvironment(environmentId);
    }

    /** @returns {Promise<Array<Object>>} */
    async getAllEnvironments() {
        try {
            return await this.service.getAllEnvironments();
        } catch (error) {
            return [];
        }
    }

    /** @returns {Promise<Object|null>} */
    async getActiveEnvironment() {
        try {
            return await this.service.getActiveEnvironment();
        } catch (error) {
            return null;
        }
    }

    /** @returns {Promise<Object>} */
    async getActiveEnvironmentVariables() {
        try {
            return await this.service.getActiveEnvironmentVariables();
        } catch (error) {
            return {};
        }
    }

    /**
     * @param {string} environmentId
     * @returns {Promise<boolean>}
     */
    async exportEnvironment(environmentId) {
        const data = await this.service.exportEnvironment(environmentId);
        const json = JSON.stringify(data, null, 2);
        await this._saveJsonExport(
            `${data.name.replace(/[^a-z0-9]/gi, '_')}_environment.json`,
            json
        );

        return true;
    }

    /** @returns {Promise<boolean>} */
    async exportAllEnvironments() {
        const data = await this.service.exportAllEnvironments();
        const json = JSON.stringify(data, null, 2);
        await this._saveJsonExport(
            `resonance_environments_${Date.now()}.json`,
            json
        );

        return true;
    }

    /**
     * @param {string} filename
     * @param {string} json
     */
    async _saveJsonExport(filename, json) {
        if (!window.backendAPI?.environments?.saveJsonExport) {
            throw new Error('Native export is not available in this runtime');
        }

        const result = await window.backendAPI.environments.saveJsonExport(filename, json);
        if (result?.cancelled) {
            return false;
        }

        return true;
    }

    /**
     * @param {Object} environment
     * @param {string} environment.name
     * @param {Object} environment.variables
     * @returns {Promise<Object>}
     */
    async handleImportEnvironment(environment) {
        const created = await this.service.createEnvironment(
            environment.name,
            environment.variables || {}
        );
        await this.onEnvironmentsChanged();
        return created;
    }

    /**
     * @param {boolean} [merge=false]
     * @returns {Promise<boolean>}
     */
    async importEnvironments(merge = false) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        return new Promise((resolve) => {
            input.onchange = async (e) => {
                try {
                    const file = e.target.files[0];
                    if (!file) {
                        resolve(false);
                        return;
                    }

                    const text = await file.text();
                    const data = JSON.parse(text);

                    await this.service.importEnvironments(data, merge);
                    resolve(true);
                } catch (error) {
                    toast.error(`Error importing environments: ${error.message}`);
                    resolve(false);
                }
            };

            input.click();
        });
    }
}
