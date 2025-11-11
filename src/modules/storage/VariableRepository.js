/**
 * @fileoverview Repository for managing collection variable persistence
 * @module storage/VariableRepository
 */

/**
 * Repository for managing collection variable persistence
 *
 * @class
 * @classdesc Handles CRUD operations for collection-scoped variables in electron-store.
 * Variables are stored per collection and used for template substitution in requests.
 * Implements defensive programming with validation and auto-initialization.
 *
 * @deprecated This repository is being phased out in favor of EnvironmentRepository
 * which provides environment-scoped variables with better organization.
 */
export class VariableRepository {
    /**
     * Creates a VariableRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge from preload script
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.VARIABLES_KEY = 'collectionVariables';
    }

    /**
     * Retrieves all variables for all collections
     *
     * Automatically initializes storage with empty object if undefined (packaged app first run).
     *
     * @async
     * @returns {Promise<Object>} Object mapping collection IDs to variable objects
     * @throws {Error} If storage access fails
     */
    async getAllVariables() {
        try {
            const variables = await this.electronAPI.store.get(this.VARIABLES_KEY);

            if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
                console.warn('Variables data is invalid or undefined, initializing with empty object');
                await this.electronAPI.store.set(this.VARIABLES_KEY, {});
                return {};
            }

            return variables;
        } catch (error) {
            console.error('Error loading variables:', error);
            throw new Error(`Failed to load variables: ${error.message}`);
        }
    }

    /**
     * Retrieves variables for a specific collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Object>} Object mapping variable names to values
     * @throws {Error} If retrieval fails
     */
    async getVariablesForCollection(collectionId) {
        try {
            const allVariables = await this.getAllVariables();
            return allVariables[collectionId] || {};
        } catch (error) {
            console.error('Error loading collection variables:', error);
            throw new Error(`Failed to load collection variables: ${error.message}`);
        }
    }

    /**
     * Sets all variables for a specific collection
     *
     * Replaces existing variables for the collection.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {Object} variables - Object mapping variable names to values
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async setVariablesForCollection(collectionId, variables) {
        try {
            const allVariables = await this.getAllVariables();
            allVariables[collectionId] = variables;
            await this.electronAPI.store.set(this.VARIABLES_KEY, allVariables);
        } catch (error) {
            console.error('Error saving collection variables:', error);
            throw new Error(`Failed to save collection variables: ${error.message}`);
        }
    }

    /**
     * Sets a single variable for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - The variable name
     * @param {*} value - The variable value
     * @returns {Promise<void>}
     * @throws {Error} If save operation fails
     */
    async setVariable(collectionId, name, value) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            variables[name] = value;
            await this.setVariablesForCollection(collectionId, variables);
        } catch (error) {
            console.error('Error setting variable:', error);
            throw new Error(`Failed to set variable: ${error.message}`);
        }
    }

    /**
     * Deletes a single variable from a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - The variable name to delete
     * @returns {Promise<void>}
     * @throws {Error} If delete operation fails
     */
    async deleteVariable(collectionId, name) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            delete variables[name];
            await this.setVariablesForCollection(collectionId, variables);
        } catch (error) {
            console.error('Error deleting variable:', error);
            throw new Error(`Failed to delete variable: ${error.message}`);
        }
    }

    /**
     * Deletes all variables for a collection
     *
     * Used when deleting a collection to clean up orphaned data.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<void>}
     * @throws {Error} If delete operation fails
     */
    async deleteAllVariablesForCollection(collectionId) {
        try {
            const allVariables = await this.getAllVariables();
            delete allVariables[collectionId];
            await this.electronAPI.store.set(this.VARIABLES_KEY, allVariables);
        } catch (error) {
            console.error('Error deleting collection variables:', error);
            throw new Error(`Failed to delete collection variables: ${error.message}`);
        }
    }

    /**
     * Retrieves a single variable value for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - The variable name
     * @returns {Promise<*>} The variable value or undefined if not found
     */
    async getVariable(collectionId, name) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return variables[name];
        } catch (error) {
            console.error('Error getting variable:', error);
            return undefined;
        }
    }
}