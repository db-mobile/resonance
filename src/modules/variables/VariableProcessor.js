/**
 * Processes variable templates in strings
 * Follows Single Responsibility Principle - only handles variable template processing
 */
export class VariableProcessor {
    constructor() {
        this.VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    }

    /**
     * Replace all variable templates in a string with their values
     * @param {string} template - String containing {{ variableName }} templates
     * @param {Object} variables - Object with variable name-value pairs
     * @returns {string} - String with variables replaced
     */
    processTemplate(template, variables = {}) {
        if (!template || typeof template !== 'string') {
            return template;
        }

        return template.replace(this.VARIABLE_PATTERN, (match, variableName) => {
            const value = variables[variableName];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            // Return original template if variable not found
            return match;
        });
    }

    /**
     * Process variables in an object recursively
     * @param {any} obj - Object to process
     * @param {Object} variables - Variable definitions
     * @returns {any} - Processed object
     */
    processObject(obj, variables = {}) {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === 'string') {
            return this.processTemplate(obj, variables);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.processObject(item, variables));
        }

        if (typeof obj === 'object') {
            const processed = {};
            for (const [key, value] of Object.entries(obj)) {
                const processedKey = this.processTemplate(key, variables);
                processed[processedKey] = this.processObject(value, variables);
            }
            return processed;
        }

        return obj;
    }

    /**
     * Extract variable names from a template string
     * @param {string} template - String containing {{ variableName }} templates
     * @returns {string[]} - Array of variable names found
     */
    extractVariableNames(template) {
        if (!template || typeof template !== 'string') {
            return [];
        }

        const matches = [];
        let match;
        
        // Reset regex lastIndex to ensure we start from the beginning
        this.VARIABLE_PATTERN.lastIndex = 0;
        
        while ((match = this.VARIABLE_PATTERN.exec(template)) !== null) {
            matches.push(match[1]);
        }

        // Remove duplicates and return
        return [...new Set(matches)];
    }

    /**
     * Extract all variable names from an object recursively
     * @param {any} obj - Object to analyze
     * @returns {string[]} - Array of unique variable names found
     */
    extractVariableNamesFromObject(obj) {
        const variableNames = new Set();

        const extractFromValue = (value) => {
            if (typeof value === 'string') {
                const names = this.extractVariableNames(value);
                names.forEach(name => variableNames.add(name));
            } else if (Array.isArray(value)) {
                value.forEach(extractFromValue);
            } else if (value && typeof value === 'object') {
                Object.keys(value).forEach(key => {
                    extractFromValue(key);
                    extractFromValue(value[key]);
                });
            }
        };

        extractFromValue(obj);
        return Array.from(variableNames);
    }

    /**
     * Validate variable name
     * @param {string} name - Variable name to validate
     * @returns {boolean} - True if valid
     */
    isValidVariableName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }
        
        // Variable names must start with letter or underscore, followed by letters, numbers, or underscores
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
    }

    /**
     * Get preview of how template would look with variables applied
     * @param {string} template - Template string
     * @param {Object} variables - Variable definitions
     * @returns {Object} - { preview: string, missingVariables: string[] }
     */
    getPreview(template, variables = {}) {
        const variableNames = this.extractVariableNames(template);
        const missingVariables = variableNames.filter(name => !(name in variables));
        const preview = this.processTemplate(template, variables);
        
        return {
            preview,
            missingVariables,
            foundVariables: variableNames.filter(name => name in variables)
        };
    }
}