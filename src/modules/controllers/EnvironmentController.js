/**
 * @fileoverview Controller for coordinating environment operations between UI and services
 * @module controllers/EnvironmentController
 */

/**
 * Controller for coordinating environment operations between UI and services
 *
 * @class
 * @classdesc Mediates between UI components (EnvironmentManager and EnvironmentSelector)
 * and the EnvironmentService, handling user interactions for environment management,
 * switching, import/export, and change notifications. Listens for service events
 * and synchronizes UI state accordingly.
 */
export class EnvironmentController {
    /**
     * Creates an EnvironmentController instance
     *
     * @param {EnvironmentService} environmentService - The environment service for business logic
     * @param {EnvironmentManager} environmentManager - The environment management dialog UI component
     * @param {EnvironmentSelector} environmentSelector - The environment selector dropdown UI component
     */
    constructor(environmentService, environmentManager, environmentSelector) {
        this.service = environmentService;
        this.manager = environmentManager;
        this.selector = environmentSelector;
    }

    /**
     * Initializes the controller and sets up event listeners
     *
     * Registers change listener for service events and loads initial active environment.
     *
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        // Listen for environment changes from service
        this.service.addChangeListener((event) => {
            this.handleEnvironmentChange(event);
        });

        // Load initial active environment
        await this.loadActiveEnvironment();
    }

    /**
     * Loads and displays the active environment in the UI
     *
     * @async
     * @returns {Promise<void>}
     */
    async loadActiveEnvironment() {
        try {
            const activeEnvironment = await this.service.getActiveEnvironment();
            if (activeEnvironment) {
                this.selector.setActiveEnvironment(activeEnvironment);
            }
        } catch (error) {
            console.error('Error loading active environment:', error);
        }
    }

    /**
     * Handles environment change events from the service
     *
     * Routes events to appropriate handlers based on event type.
     *
     * @param {Object} event - The environment change event
     * @param {string} event.type - Event type (environment-switched, environment-created, etc.)
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
     * Handles environment switch event and updates UI
     *
     * @async
     * @param {Object} _event - The environment switch event (unused but kept for consistency)
     * @returns {Promise<void>}
     * @private
     */
    async onEnvironmentSwitched(_event) {
        try {
            const environment = await this.service.getActiveEnvironment();
            if (environment) {
                this.selector.setActiveEnvironment(environment);
            }
        } catch (error) {
            console.error('Error handling environment switch:', error);
        }
    }

    /**
     * Handles changes to the environments list and refreshes UI
     *
     * Updates active environment display and refreshes selector dropdown.
     *
     * @async
     * @returns {Promise<void>}
     * @private
     */
    async onEnvironmentsChanged() {
        try {
            const activeEnvironment = await this.service.getActiveEnvironment();
            if (activeEnvironment) {
                this.selector.setActiveEnvironment(activeEnvironment);
            }
            // Refresh selector dropdown
            await this.selector.refresh();
        } catch (error) {
            console.error('Error handling environments change:', error);
        }
    }

    /**
     * Switches to a different environment
     *
     * @async
     * @param {string} environmentId - The ID of the environment to activate
     * @returns {Promise<boolean>} True if successful, false on error
     */
    async switchEnvironment(environmentId) {
        try {
            await this.service.switchEnvironment(environmentId);
            return true;
        } catch (error) {
            console.error('Error switching environment:', error);
            return false;
        }
    }

    /**
     * Opens the environment manager dialog
     *
     * Shows the environment management UI and refreshes on close if changes were made.
     *
     * @async
     * @returns {Promise<void>}
     */
    async openEnvironmentManager() {
        try {
            const result = await this.manager.show();
            if (result) {
                // Refresh UI after changes
                await this.onEnvironmentsChanged();
            }
        } catch (error) {
            console.error('Error opening environment manager:', error);
        }
    }

    /**
     * Creates a new environment
     *
     * @async
     * @param {string} name - The environment name
     * @param {Object} [variables={}] - Initial variables for the environment
     * @returns {Promise<Object>} The created environment object
     * @throws {Error} If creation fails
     */
    async createEnvironment(name, variables = {}) {
        try {
            const environment = await this.service.createEnvironment(name, variables);
            return environment;
        } catch (error) {
            console.error('Error creating environment:', error);
            throw error;
        }
    }

    /**
     * Updates an existing environment
     *
     * @async
     * @param {string} environmentId - The environment ID to update
     * @param {Object} updates - Object containing fields to update (name, variables, etc.)
     * @returns {Promise<Object>} The updated environment object
     * @throws {Error} If update fails
     */
    async updateEnvironment(environmentId, updates) {
        try {
            return await this.service.updateEnvironment(environmentId, updates);
        } catch (error) {
            console.error('Error updating environment:', error);
            throw error;
        }
    }

    /**
     * Deletes an environment
     *
     * @async
     * @param {string} environmentId - The environment ID to delete
     * @returns {Promise<boolean>} True if deletion was successful
     * @throws {Error} If deletion fails
     */
    async deleteEnvironment(environmentId) {
        try {
            return await this.service.deleteEnvironment(environmentId);
        } catch (error) {
            console.error('Error deleting environment:', error);
            throw error;
        }
    }

    /**
     * Duplicates an existing environment
     *
     * Creates a copy of the environment with " (Copy)" appended to the name.
     *
     * @async
     * @param {string} environmentId - The environment ID to duplicate
     * @returns {Promise<Object>} The newly created duplicate environment
     * @throws {Error} If duplication fails
     */
    async duplicateEnvironment(environmentId) {
        try {
            return await this.service.duplicateEnvironment(environmentId);
        } catch (error) {
            console.error('Error duplicating environment:', error);
            throw error;
        }
    }

    /**
     * Gets all environments
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of all environment objects, or empty array on error
     */
    async getAllEnvironments() {
        try {
            return await this.service.getAllEnvironments();
        } catch (error) {
            console.error('Error getting all environments:', error);
            return [];
        }
    }

    /**
     * Gets the currently active environment
     *
     * @async
     * @returns {Promise<Object|null>} The active environment object, or null if none active or on error
     */
    async getActiveEnvironment() {
        try {
            return await this.service.getActiveEnvironment();
        } catch (error) {
            console.error('Error getting active environment:', error);
            return null;
        }
    }

    /**
     * Gets variables from the active environment
     *
     * @async
     * @returns {Promise<Object>} Variables object from active environment, or empty object if none active or on error
     */
    async getActiveEnvironmentVariables() {
        try {
            return await this.service.getActiveEnvironmentVariables();
        } catch (error) {
            console.error('Error getting active environment variables:', error);
            return {};
        }
    }

    /**
     * Exports an environment as a JSON file download
     *
     * @async
     * @param {string} environmentId - The environment ID to export
     * @returns {Promise<boolean>} True if export was successful
     * @throws {Error} If export fails
     */
    async exportEnvironment(environmentId) {
        try {
            const data = await this.service.exportEnvironment(environmentId);
            const json = JSON.stringify(data, null, 2);

            // Create blob and download
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${data.name.replace(/[^a-z0-9]/gi, '_')}_environment.json`;
            a.click();
            URL.revokeObjectURL(url);

            return true;
        } catch (error) {
            console.error('Error exporting environment:', error);
            throw error;
        }
    }

    /**
     * Exports all environments as a JSON file download
     *
     * @async
     * @returns {Promise<boolean>} True if export was successful
     * @throws {Error} If export fails
     */
    async exportAllEnvironments() {
        try {
            const data = await this.service.exportAllEnvironments();
            const json = JSON.stringify(data, null, 2);

            // Create blob and download
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `resonance_environments_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);

            return true;
        } catch (error) {
            console.error('Error exporting all environments:', error);
            throw error;
        }
    }

    /**
     * Imports environments from a JSON file
     *
     * Shows file picker dialog and imports environments with optional merge.
     *
     * @async
     * @param {boolean} [merge=false] - If true, merges with existing environments; if false, replaces all
     * @returns {Promise<boolean>} True if import was successful, false if cancelled or failed
     * @throws {Error} If import fails
     */
    async importEnvironments(merge = false) {
        try {
            // Create file input
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
                        console.error('Error importing environments:', error);
                        alert(`Error importing environments: ${error.message}`);
                        resolve(false);
                    }
                };

                input.click();
            });
        } catch (error) {
            console.error('Error importing environments:', error);
            throw error;
        }
    }
}
