/**
 * @fileoverview Service for managing variable business logic and template processing
 * @module services/VariableService
 */

/**
 * Service for managing variable business logic
 *
 * @class
 * @classdesc Provides high-level variable operations including storage, retrieval,
 * validation, and template processing. Handles both collection-scoped and
 * environment-scoped variables with precedence rules (environment variables
 * override collection variables). Coordinates with VariableProcessor for
 * template substitution and with repositories for persistence.
 */
export class VariableService {
    /**
     * Creates a VariableService instance
     *
     * @param {VariableRepository} variableRepository - Data access layer for collection variables
     * @param {VariableProcessor} variableProcessor - Template processing engine
     * @param {IStatusDisplay} statusDisplay - Status display interface
     * @param {EnvironmentRepository} [environmentRepository=null] - Optional environment repository
     */
    constructor(variableRepository, variableProcessor, statusDisplay, environmentRepository = null) {
        this.repository = variableRepository;
        this.processor = variableProcessor;
        this.statusDisplay = statusDisplay;
        this.environmentRepository = environmentRepository;
    }

    /**
     * Gets variables from active environment only
     *
     * Returns environment variables only (no collection context).
     * For collection-specific variables, use getVariablesForCollection().
     *
     * @async
     * @returns {Promise<Object>} Environment variables as key-value object
     */
    async getVariables() {
        try {
            // If environment repository is available, use active environment variables
            if (this.environmentRepository) {
                return await this.environmentRepository.getActiveEnvironmentVariables();
            }

            // No environment variables available
            return {};
        } catch (error) {
            console.error('Error loading variables:', error);
            return {};
        }
    }

    /**
     * Gets variables for a specific collection with environment precedence
     *
     * Merges collection variables with active environment variables.
     * Environment variables take precedence over collection variables.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Object>} Merged variables as key-value object
     * @throws {Error} If variable loading fails
     */
    async getVariablesForCollection(collectionId) {
        try {
            let variables = {};

            // Start with collection variables as base
            const collectionVariables = await this.repository.getVariablesForCollection(collectionId);
            variables = { ...collectionVariables };

            // If environment repository exists, merge environment variables (with precedence)
            if (this.environmentRepository) {
                const environmentVariables = await this.environmentRepository.getActiveEnvironmentVariables();
                // Environment variables override collection variables
                variables = { ...variables, ...environmentVariables };
            }

            return variables;
        } catch (error) {
            this.statusDisplay.update(`Error loading variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Sets a single variable for a collection
     *
     * Validates variable name before saving.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - Variable name (must be valid identifier)
     * @param {string} value - Variable value
     * @returns {Promise<boolean>} True if successful
     * @throws {Error} If variable name is invalid or save fails
     */
    async setVariable(collectionId, name, value) {
        try {
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

    /**
     * Deletes a variable from a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} name - Variable name to delete
     * @returns {Promise<boolean>} True if successful
     * @throws {Error} If deletion fails
     */
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

    /**
     * Sets multiple variables for a collection
     *
     * Validates all variable names before saving.
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {Object} variables - Variables as key-value object
     * @returns {Promise<boolean>} True if successful
     * @throws {Error} If any variable name is invalid or save fails
     */
    async setMultipleVariables(collectionId, variables) {
        try {
            for (const name of Object.keys(variables)) {
                if (!this.processor.isValidVariableName(name)) {
                    throw new Error(`Invalid variable name: ${name}`);
                }
            }

            await this.repository.setVariablesForCollection(collectionId, variables);
            this.statusDisplay.update('Variables saved successfully', null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error saving variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Processes a request object with variable substitution
     *
     * Replaces {{variableName}} templates with actual values.
     *
     * @async
     * @param {Object} request - The request object to process
     * @param {string} collectionId - The collection ID for variable context
     * @returns {Promise<Object>} Processed request object
     */
    async processRequest(request, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processObject(request, variables);
        } catch (error) {
            console.error('Error processing request variables:', error);
            return request;
        }
    }

    /**
     * Processes a template string with variable substitution
     *
     * @async
     * @param {string} template - The template string
     * @param {string} collectionId - The collection ID for variable context
     * @returns {Promise<string>} Processed string
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
     * Gets a preview of template substitution with variable analysis
     *
     * @async
     * @param {string} template - The template string
     * @param {string} collectionId - The collection ID for variable context
     * @returns {Promise<Object>} Preview object with processed string and variable info
     * @returns {Promise<Object>} result.preview - Processed template
     * @returns {Promise<Array<string>>} result.missingVariables - Variables not found
     * @returns {Promise<Array<string>>} result.foundVariables - Variables that were substituted
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
     * Finds all variable names used in a request object
     *
     * @param {Object} request - The request object to analyze
     * @returns {Array<string>} Array of unique variable names found
     */
    findUsedVariables(request) {
        return this.processor.extractVariableNamesFromObject(request);
    }

    /**
     * Deletes all variables for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<void>}
     */
    async cleanupCollectionVariables(collectionId) {
        try {
            await this.repository.deleteAllVariablesForCollection(collectionId);
        } catch (error) {
            console.error('Error cleaning up collection variables:', error);
        }
    }

    /**
     * Exports all variables for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Object>} Variables as key-value object
     */
    async exportVariables(collectionId) {
        return this.getVariablesForCollection(collectionId);
    }

    /**
     * Imports variables for a collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {Object} variables - Variables to import as key-value object
     * @param {boolean} [merge=false] - If true, merges with existing variables
     * @returns {Promise<boolean>} True if successful
     * @throws {Error} If import fails
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