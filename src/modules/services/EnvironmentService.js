/**
 * @fileoverview Service for managing environment business logic with event notifications
 * @module services/EnvironmentService
 */

/**
 * Service for managing environment business logic
 *
 * @class
 * @classdesc Provides high-level environment operations with validation, error handling,
 * and event notifications. Manages environment CRUD operations, active environment state,
 * variable management, and import/export functionality. Implements observer pattern for
 * environment change notifications to keep UI synchronized.
 *
 * Event types emitted:
 * - 'environment-switched': When active environment changes
 * - 'environment-created': When new environment is created
 * - 'environment-updated': When environment is modified
 * - 'environment-deleted': When environment is removed
 * - 'environments-imported': When environments are imported
 */
export class EnvironmentService {
    /**
     * Creates an EnvironmentService instance
     *
     * @param {EnvironmentRepository} environmentRepository - Data access layer
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(environmentRepository, statusDisplay) {
        this.repository = environmentRepository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * Registers a listener for environment changes
     *
     * Listener receives event objects with type and relevant data.
     *
     * @param {Function} callback - The callback function
     * @param {Object} callback.event - Event object
     * @param {string} callback.event.type - Event type
     * @returns {void}
     */
    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * Removes a change listener
     *
     * @param {Function} callback - The callback function to remove
     * @returns {void}
     */
    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Notifies all listeners of environment change
     *
     * Catches and logs listener errors to prevent disruption.
     *
     * @private
     * @param {Object} event - Event object with type and data
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

    /**
     * Gets all environments
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of environment objects
     * @throws {Error} If loading fails
     */
    async getAllEnvironments() {
        try {
            const data = await this.repository.getAllEnvironments();
            return data.items;
        } catch (error) {
            this.statusDisplay.update(`Error loading environments: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Gets the active environment
     *
     * @async
     * @returns {Promise<Object|null>} Active environment object or null if none active
     */
    async getActiveEnvironment() {
        try {
            return await this.repository.getActiveEnvironment();
        } catch (error) {
            return null;
        }
    }

    /**
     * Gets the active environment ID
     *
     * @async
     * @returns {Promise<string|null>} Active environment ID or null if none active
     */
    async getActiveEnvironmentId() {
        try {
            return await this.repository.getActiveEnvironmentId();
        } catch (error) {
            return null;
        }
    }

    /**
     * Switches to a different environment
     *
     * Updates active environment and notifies listeners of change.
     *
     * @async
     * @param {string} environmentId - The ID of environment to activate
     * @returns {Promise<Object>} The activated environment object
     * @throws {Error} If environment not found or switch fails
     * @fires EnvironmentService#environment-switched
     */
    async switchEnvironment(environmentId) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            await this.repository.setActiveEnvironment(environmentId);
            this.statusDisplay.update(`Switched to environment: ${environment.name}`, null);

            this._notifyListeners({
                type: 'environment-switched',
                environmentId: environmentId,
                environmentName: environment.name
            });

            return environment;
        } catch (error) {
            this.statusDisplay.update(`Error switching environment: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Creates a new environment
     *
     * Validates name and notifies listeners of creation.
     *
     * @async
     * @param {string} name - Environment name (required, non-empty)
     * @param {Object} [variables={}] - Initial variables as key-value object
     * @returns {Promise<Object>} The created environment object
     * @throws {Error} If name is invalid or creation fails
     * @fires EnvironmentService#environment-created
     */
    async createEnvironment(name, variables = {}) {
        try {
            if (!name || typeof name !== 'string' || name.trim() === '') {
                throw new Error('Environment name is required');
            }

            const trimmedName = name.trim();
            const newEnvironment = await this.repository.createEnvironment(trimmedName, variables);

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
     * Updates an environment
     *
     * Validates updates and notifies listeners of change.
     *
     * @async
     * @param {string} environmentId - The environment ID
     * @param {Object} updates - Update object
     * @param {string} [updates.name] - New name (validated if provided)
     * @param {Object} [updates.variables] - New variables object
     * @returns {Promise<Object>} The updated environment object
     * @throws {Error} If validation fails or update fails
     * @fires EnvironmentService#environment-updated
     */
    async updateEnvironment(environmentId, updates) {
        try {
            if (updates.name !== undefined) {
                if (!updates.name || typeof updates.name !== 'string' || updates.name.trim() === '') {
                    throw new Error('Environment name cannot be empty');
                }
                updates.name = updates.name.trim();
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
     * Renames an environment
     *
     * Convenience method that calls updateEnvironment.
     *
     * @async
     * @param {string} environmentId - The environment ID
     * @param {string} newName - New name for environment
     * @returns {Promise<Object>} The updated environment object
     * @throws {Error} If name is invalid or update fails
     */
    async renameEnvironment(environmentId, newName) {
        return this.updateEnvironment(environmentId, { name: newName });
    }

    /**
     * Deletes an environment
     *
     * Notifies listeners of deletion.
     *
     * @async
     * @param {string} environmentId - The environment ID to delete
     * @returns {Promise<boolean>} True if deletion successful
     * @throws {Error} If environment not found or deletion fails
     * @fires EnvironmentService#environment-deleted
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
     * Duplicates an environment
     *
     * Creates a copy with unique name and notifies listeners.
     *
     * @async
     * @param {string} environmentId - The environment ID to duplicate
     * @returns {Promise<Object>} The duplicated environment object
     * @throws {Error} If environment not found or duplication fails
     * @fires EnvironmentService#environment-created
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

    /**
     * Get variables from active environment
     */
    async getActiveEnvironmentVariables() {
        try {
            return await this.repository.getActiveEnvironmentVariables();
        } catch (error) {
            return {};
        }
    }

    /**
     * Update variables in environment
     */
    async updateEnvironmentVariables(environmentId, variables) {
        try {
            return await this.updateEnvironment(environmentId, { variables });
        } catch (error) {
            this.statusDisplay.update(`Error updating environment variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Set variable in environment
     */
    async setVariable(environmentId, name, value) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            const variables = { ...environment.variables, [name]: value };
            await this.updateEnvironment(environmentId, { variables });

            return true;
        } catch (error) {
            this.statusDisplay.update(`Error setting variable: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Delete variable from environment
     */
    async deleteVariable(environmentId, name) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            const variables = { ...environment.variables };
            delete variables[name];
            await this.updateEnvironment(environmentId, { variables });

            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting variable: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Export environment
     */
    async exportEnvironment(environmentId) {
        try {
            const environment = await this.repository.getEnvironmentById(environmentId);
            if (!environment) {
                throw new Error('Environment not found');
            }

            return {
                name: environment.name,
                variables: environment.variables
            };
        } catch (error) {
            this.statusDisplay.update(`Error exporting environment: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Export all environments
     */
    async exportAllEnvironments() {
        try {
            const data = await this.repository.exportEnvironments();
            return {
                version: '1.0',
                environments: data.items.map(env => ({
                    name: env.name,
                    variables: env.variables
                }))
            };
        } catch (error) {
            this.statusDisplay.update(`Error exporting environments: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Import environments
     */
    async importEnvironments(data, merge = false) {
        try {
            // Validate import data
            if (!data || !Array.isArray(data.environments)) {
                throw new Error('Invalid import data format');
            }

            const environmentsData = {
                items: data.environments.map(env => ({
                    id: null, // Will be generated by repository
                    name: env.name || 'Imported Environment',
                    variables: env.variables || {}
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

    /**
     * Generate unique environment name
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

    /**
     * Validate environment name
     */
    isValidEnvironmentName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        const trimmed = name.trim();
        return trimmed.length > 0 && trimmed.length <= 100;
    }
}
