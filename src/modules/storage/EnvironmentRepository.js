/**
 * @fileoverview Repository for managing environment data persistence
 * @module storage/EnvironmentRepository
 */

/**
 * Repository for managing environment data persistence
 *
 * @class
 * @classdesc Handles CRUD operations for environments and active environment tracking
 * in electron-store. Environments provide variable scoping for different contexts
 * (Development, Staging, Production, etc.). Implements defensive programming with
 * validation, auto-initialization, and duplicate name detection. Ensures at least
 * one environment always exists and is active.
 */
export class EnvironmentRepository {
    /**
     * Creates an EnvironmentRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge from preload script
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.ENVIRONMENTS_KEY = 'environments';
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
        try {
            const data = await this.electronAPI.store.get(this.ENVIRONMENTS_KEY);

            if (!data || typeof data !== 'object') {
                console.warn('Environments data is invalid or undefined, initializing with defaults');
                const defaultData = this._getDefaultEnvironments();
                await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, defaultData);
                return defaultData;
            }

            // Validate structure
            if (!Array.isArray(data.items)) {
                console.warn('Environments items array is missing, initializing');
                const defaultData = this._getDefaultEnvironments();
                await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, defaultData);
                return defaultData;
            }

            return data;
        } catch (error) {
            console.error('Error loading environments:', error);
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
            console.error('Error getting active environment ID:', error);
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

            // Verify environment exists
            const exists = data.items.some(env => env.id === environmentId);
            if (!exists) {
                throw new Error(`Environment with ID ${environmentId} not found`);
            }

            data.activeEnvironmentId = environmentId;
            await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return true;
        } catch (error) {
            console.error('Error setting active environment:', error);
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
            console.error('Error getting environment by ID:', error);
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
            console.error('Error getting active environment:', error);
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
    async createEnvironment(name, variables = {}) {
        try {
            const data = await this.getAllEnvironments();

            // Check for duplicate name
            const nameExists = data.items.some(env => env.name === name);
            if (nameExists) {
                throw new Error(`Environment with name "${name}" already exists`);
            }

            const newEnvironment = {
                id: this._generateId(),
                name: name,
                variables: variables
            };

            data.items.push(newEnvironment);
            await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, data);

            return newEnvironment;
        } catch (error) {
            console.error('Error creating environment:', error);
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

            // Check for duplicate name if name is being updated
            if (updates.name && updates.name !== data.items[index].name) {
                const nameExists = data.items.some(env => env.name === updates.name);
                if (nameExists) {
                    throw new Error(`Environment with name "${updates.name}" already exists`);
                }
            }

            // Update environment
            data.items[index] = {
                ...data.items[index],
                ...updates,
                id: environmentId // Preserve ID
            };

            await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return data.items[index];
        } catch (error) {
            console.error('Error updating environment:', error);
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

            // Prevent deleting the last environment
            if (data.items.length <= 1) {
                throw new Error('Cannot delete the last environment');
            }

            const index = data.items.findIndex(env => env.id === environmentId);
            if (index === -1) {
                throw new Error(`Environment with ID ${environmentId} not found`);
            }

            // Remove environment
            data.items.splice(index, 1);

            // If deleting active environment, set first environment as active
            if (data.activeEnvironmentId === environmentId) {
                data.activeEnvironmentId = data.items[0].id;
            }

            await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return true;
        } catch (error) {
            console.error('Error deleting environment:', error);
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

            return await this.createEnvironment(
                newName || `${environment.name} (Copy)`,
                { ...environment.variables }
            );
        } catch (error) {
            console.error('Error duplicating environment:', error);
            throw new Error(`Failed to duplicate environment: ${error.message}`);
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
            return activeEnv?.variables || {};
        } catch (error) {
            console.error('Error getting active environment variables:', error);
            return {};
        }
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
                    variables: {}
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
            console.error('Error exporting environments:', error);
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
                // Add imported environments, handling duplicates
                environmentsData.items.forEach(importedEnv => {
                    const exists = data.items.some(env => env.name === importedEnv.name);
                    if (!exists) {
                        data.items.push({
                            ...importedEnv,
                            id: this._generateId() // Generate new ID
                        });
                    }
                });
            } else {
                // Replace all environments
                data = {
                    items: environmentsData.items.map(env => ({
                        ...env,
                        id: this._generateId() // Generate new IDs
                    })),
                    activeEnvironmentId: null
                };
                // Set first environment as active
                if (data.items.length > 0) {
                    data.activeEnvironmentId = data.items[0].id;
                }
            }

            await this.electronAPI.store.set(this.ENVIRONMENTS_KEY, data);
            return true;
        } catch (error) {
            console.error('Error importing environments:', error);
            throw new Error(`Failed to import environments: ${error.message}`);
        }
    }
}
