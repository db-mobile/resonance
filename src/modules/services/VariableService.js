/**
 * Service for managing collection variables business logic
 * Follows Single Responsibility Principle - only handles variable business logic
 */
export class VariableService {
    constructor(variableRepository, variableProcessor, statusDisplay) {
        this.repository = variableRepository;
        this.processor = variableProcessor;
        this.statusDisplay = statusDisplay;
    }

    async getVariablesForCollection(collectionId) {
        try {
            return await this.repository.getVariablesForCollection(collectionId);
        } catch (error) {
            this.statusDisplay.update(`Error loading variables: ${error.message}`, null);
            throw error;
        }
    }

    async setVariable(collectionId, name, value) {
        try {
            // Validate variable name
            if (!this.processor.isValidVariableName(name)) {
                throw new Error(`Invalid variable name: ${name}. Variable names must start with a letter or underscore, followed by letters, numbers, or underscores.`);
            }

            await this.repository.setVariable(collectionId, name, value);
            this.statusDisplay.update(`Variable "${name}" saved`, null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error saving variable: ${error.message}`, null);
            throw error;
        }
    }

    async deleteVariable(collectionId, name) {
        try {
            await this.repository.deleteVariable(collectionId, name);
            this.statusDisplay.update(`Variable "${name}" deleted`, null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting variable: ${error.message}`, null);
            throw error;
        }
    }

    async setMultipleVariables(collectionId, variables) {
        try {
            // Validate all variable names first
            for (const name of Object.keys(variables)) {
                if (!this.processor.isValidVariableName(name)) {
                    throw new Error(`Invalid variable name: ${name}`);
                }
            }

            await this.repository.setVariablesForCollection(collectionId, variables);
            this.statusDisplay.update(`Variables saved successfully`, null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error saving variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Process a request object by replacing all variable templates
     * @param {Object} request - Request object with potential variables
     * @param {string} collectionId - Collection ID to get variables from
     * @returns {Object} - Processed request object
     */
    async processRequest(request, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processObject(request, variables);
        } catch (error) {
            console.error('Error processing request variables:', error);
            // Return original request if variable processing fails
            return request;
        }
    }

    /**
     * Process template strings with variables
     * @param {string} template - Template string
     * @param {string} collectionId - Collection ID
     * @returns {string} - Processed string
     */
    async processTemplate(template, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processTemplate(template, variables);
        } catch (error) {
            console.error('Error processing template:', error);
            return template;
        }
    }

    /**
     * Get preview of how template would look with current variables
     * @param {string} template - Template string
     * @param {string} collectionId - Collection ID
     * @returns {Object} - Preview information
     */
    async getTemplatePreview(template, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.getPreview(template, variables);
        } catch (error) {
            console.error('Error getting template preview:', error);
            return { preview: template, missingVariables: [], foundVariables: [] };
        }
    }

    /**
     * Find all variables used in a request object
     * @param {Object} request - Request object to analyze
     * @returns {string[]} - Array of variable names used
     */
    findUsedVariables(request) {
        return this.processor.extractVariableNamesFromObject(request);
    }

    /**
     * Clean up variables when a collection is deleted
     * @param {string} collectionId - Collection ID
     */
    async cleanupCollectionVariables(collectionId) {
        try {
            await this.repository.deleteAllVariablesForCollection(collectionId);
        } catch (error) {
            console.error('Error cleaning up collection variables:', error);
        }
    }

    /**
     * Export variables for a collection
     * @param {string} collectionId - Collection ID
     * @returns {Object} - Variables object
     */
    async exportVariables(collectionId) {
        return await this.getVariablesForCollection(collectionId);
    }

    /**
     * Import variables for a collection
     * @param {string} collectionId - Collection ID
     * @param {Object} variables - Variables to import
     * @param {boolean} merge - Whether to merge with existing variables
     */
    async importVariables(collectionId, variables, merge = false) {
        try {
            let finalVariables = variables;
            
            if (merge) {
                const existingVariables = await this.getVariablesForCollection(collectionId);
                finalVariables = { ...existingVariables, ...variables };
            }

            await this.setMultipleVariables(collectionId, finalVariables);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error importing variables: ${error.message}`, null);
            throw error;
        }
    }
}