/**
 * Service for managing environment business logic
 * Provides high-level environment operations with validation
 */
export class EnvironmentService {
    constructor(environmentRepository, statusDisplay) {
        this.repository = environmentRepository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * Register listener for environment changes
     */
    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * Remove change listener
     */
    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of environment change
     */
    _notifyListeners(event) {
        this.listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in environment change listener:', error);
            }
        });
    }

    /**
     * Get all environments
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
     * Get active environment
     */
    async getActiveEnvironment() {
        try {
            return await this.repository.getActiveEnvironment();
        } catch (error) {
            console.error('Error getting active environment:', error);
            return null;
        }
    }

    /**
     * Get active environment ID
     */
    async getActiveEnvironmentId() {
        try {
            return await this.repository.getActiveEnvironmentId();
        } catch (error) {
            console.error('Error getting active environment ID:', error);
            return null;
        }
    }

    /**
     * Switch active environment
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
     * Create new environment
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
     * Update environment
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

            this.statusDisplay.update(`Environment updated`, null);

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
     * Rename environment
     */
    async renameEnvironment(environmentId, newName) {
        return await this.updateEnvironment(environmentId, { name: newName });
    }

    /**
     * Delete environment
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
     * Duplicate environment
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
            console.error('Error getting active environment variables:', error);
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
