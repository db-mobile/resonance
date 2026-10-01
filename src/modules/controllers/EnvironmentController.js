/**
 * @fileoverview Controller for coordinating environment operations between UI and services
 * @module controllers/EnvironmentController
 */

import { app } from '../appContext.js';

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
                this.onEnvironmentSwitched();
                break;
            case 'environment-created':
            case 'environment-updated':
            case 'environment-deleted':
            case 'environments-imported':
                this.onEnvironmentsChanged();
                break;
        }
    }

    /** @returns {Promise<void>} */
    async onEnvironmentSwitched() {
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
}
