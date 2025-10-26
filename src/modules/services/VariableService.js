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

    async processRequest(request, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processObject(request, variables);
        } catch (error) {
            console.error('Error processing request variables:', error);
            return request;
        }
    }

    async processTemplate(template, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.processTemplate(template, variables);
        } catch (error) {
            console.error('Error processing template:', error);
            return template;
        }
    }

    async getTemplatePreview(template, collectionId) {
        try {
            const variables = await this.getVariablesForCollection(collectionId);
            return this.processor.getPreview(template, variables);
        } catch (error) {
            console.error('Error getting template preview:', error);
            return { preview: template, missingVariables: [], foundVariables: [] };
        }
    }

    findUsedVariables(request) {
        return this.processor.extractVariableNamesFromObject(request);
    }

    async cleanupCollectionVariables(collectionId) {
        try {
            await this.repository.deleteAllVariablesForCollection(collectionId);
        } catch (error) {
            console.error('Error cleaning up collection variables:', error);
        }
    }

    async exportVariables(collectionId) {
        return await this.getVariablesForCollection(collectionId);
    }

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