/**
 * Repository for managing collection variables
 * Follows Single Responsibility Principle - only handles variable data persistence
 */
export class VariableRepository {
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.VARIABLES_KEY = 'collectionVariables';
    }

    async getAllVariables() {
        try {
            const variables = await this.electronAPI.store.get(this.VARIABLES_KEY);

            // Handle cases where store returns undefined (e.g., packaged Debian installations on first run)
            if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
                console.warn('Variables data is invalid or undefined, initializing with empty object');
                // Initialize store with empty object
                await this.electronAPI.store.set(this.VARIABLES_KEY, {});
                return {};
            }

            return variables;
        } catch (error) {
            console.error('Error loading variables:', error);
            throw new Error(`Failed to load variables: ${error.message}`);
        }
    }

    async getVariablesForCollection(collectionId) {
        try {
            const allVariables = await this.getAllVariables();
            return allVariables[collectionId] || {};
        } catch (error) {
            console.error('Error loading collection variables:', error);
            throw new Error(`Failed to load collection variables: ${error.message}`);
        }
    }

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