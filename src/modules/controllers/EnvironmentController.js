/**
 * Controller for coordinating environment operations between UI and services
 */
export class EnvironmentController {
    constructor(environmentService, environmentManager, environmentSelector) {
        this.service = environmentService;
        this.manager = environmentManager;
        this.selector = environmentSelector;
    }

    /**
     * Initialize controller
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
     * Load and display active environment
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
     * Handle environment change events
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
     * Handle environment switch
     */
    async onEnvironmentSwitched(event) {
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
     * Handle environments list change
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
     * Switch to environment
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
     * Open environment manager dialog
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
     * Create new environment
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
     * Update environment
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
     * Delete environment
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
     * Duplicate environment
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
     * Get all environments
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
     * Get active environment
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
     * Get active environment variables
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
     * Export environment
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
     * Export all environments
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
     * Import environments from file
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
