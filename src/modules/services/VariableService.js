/**
 * @fileoverview Service for managing variable business logic and template processing
 * @module services/VariableService
 */

export class VariableService {
    /**
     * @param {VariableRepository} variableRepository
     * @param {VariableProcessor} variableProcessor
     * @param {IStatusDisplay} statusDisplay
     * @param {EnvironmentRepository} [environmentRepository=null]
     */
    constructor(variableRepository, variableProcessor, statusDisplay, environmentRepository = null) {
        this.repository = variableRepository;
        this.processor = variableProcessor;
        this.statusDisplay = statusDisplay;
        this.environmentRepository = environmentRepository;
    }

    /** @returns {Promise<Object>} */
    async getVariables() {
        try {
            if (this.environmentRepository) {
                return await this.environmentRepository.getActiveEnvironmentVariables();
            }

            return {};
        } catch (error) {
            return {};
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async getVariablesForCollection(collectionId) {
        try {
            let variables = {};

            const collectionVariables = await this.repository.getVariablesForCollection(collectionId);
            variables = { ...collectionVariables };

            if (this.environmentRepository) {
                const environmentVariables = await this.environmentRepository.getActiveEnvironmentVariables();
                variables = { ...variables, ...environmentVariables };
            }

            return variables;
        } catch (error) {
            this.statusDisplay.update(`Error loading variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} name
     * @param {string} value
     * @returns {Promise<boolean>}
     */
    async setVariable(collectionId, name, value) {
        try {
            if (!this.processor.isValidVariableName(name)) {
                throw new Error(`Invalid variable name: ${name}. Variable names must start with a letter, digit, or underscore, followed by letters, digits, underscores, hyphens, or dots.`);
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
     * @param {string} collectionId
     * @param {string} name
     * @returns {Promise<boolean>}
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
     * @param {string} collectionId
     * @param {Object} variables
     * @param {Array<string>} [secretKeys=[]]
     * @returns {Promise<boolean>}
     */
    async setMultipleVariables(collectionId, variables, secretKeys = []) {
        try {
            for (const name of Object.keys(variables)) {
                if (!this.processor.isValidVariableName(name)) {
                    throw new Error(`Invalid variable name: ${name}`);
                }
            }

            await this.repository.setVariablesForCollection(collectionId, variables, secretKeys);
            this.statusDisplay.update('Variables saved successfully', null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error saving variables: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<{name: string, value: string, secret: boolean}>>}
     */
    async getCollectionVariableEntries(collectionId) {
        try {
            return await this.repository.getVariableEntriesForCollection(collectionId);
        } catch (error) {
            return [];
        }
    }

    /**
     * @param {Object} request
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async processRequest(request, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processObject(request, variables);
        } catch (error) {
            return request;
        }
    }

    /**
     * @param {string} template
     * @param {string} collectionId
     * @returns {Promise<string>}
     */
    async processTemplate(template, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processTemplate(template, variables);
        } catch (error) {
            return template;
        }
    }

    /**
     * @param {string} template
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async getTemplatePreview(template, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.getPreview(template, variables);
        } catch (error) {
            return { preview: template, missingVariables: [], foundVariables: [] };
        }
    }

    /**
     * @param {Object} request
     * @returns {Array<string>}
     */
    findUsedVariables(request) {
        return this.processor.extractVariableNamesFromObject(request);
    }

    /**
     * @param {string} collectionId
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
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async exportVariables(collectionId) {
        return this.getVariablesForCollection(collectionId);
    }

    /**
     * @param {string} collectionId
     * @param {Object} variables
     * @param {boolean} [merge=false]
     * @returns {Promise<boolean>}
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