/**
 * Repository for managing environment data persistence
 * Handles CRUD operations for environments and active environment tracking
 */
export class EnvironmentRepository {
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.ENVIRONMENTS_KEY = 'environments';
    }

    /**
     * Get all environments with validation and initialization
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
     * Get active environment ID
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
     * Set active environment
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
     * Get environment by ID
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
     * Get active environment
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
     * Create new environment
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
     * Update environment
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
     * Delete environment
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
     * Duplicate environment
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
     * Get variables for active environment
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
     * Generate unique ID
     */
    _generateId() {
        return `env_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get default environments structure
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
     * Export all environments
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
     * Import environments
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
