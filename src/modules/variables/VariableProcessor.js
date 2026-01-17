import { DynamicVariableGenerator } from './DynamicVariableGenerator.js';

export class VariableProcessor {
    constructor() {
        this.VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
        // Dynamic variables with $ prefix and optional :params
        this.DYNAMIC_VARIABLE_PATTERN = /\{\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\s*\}\}/g;
        this.dynamicGenerator = new DynamicVariableGenerator();
    }

    processTemplate(template, variables = {}) {
        if (!template || typeof template !== 'string') {
            return template;
        }

        // First, process dynamic variables ({{$name}} or {{$name:params}})
        let result = template.replace(this.DYNAMIC_VARIABLE_PATTERN, (match, variableName, params) => {
            if (this.dynamicGenerator.isDynamicVariable(variableName)) {
                const value = this.dynamicGenerator.generate(variableName, params || null);
                return String(value);
            }
            // Unknown dynamic variable - leave unchanged
            return match;
        });

        // Then, process regular variables ({{name}})
        result = result.replace(this.VARIABLE_PATTERN, (match, variableName) => {
            const value = variables[variableName];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            return match;
        });

        return result;
    }

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

    extractVariableNames(template) {
        if (!template || typeof template !== 'string') {
            return [];
        }

        const matches = [];
        let match;
        
        this.VARIABLE_PATTERN.lastIndex = 0;
        
        while ((match = this.VARIABLE_PATTERN.exec(template)) !== null) {
            matches.push(match[1]);
        }

        return [...new Set(matches)];
    }

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

    isValidVariableName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
    }

    /**
     * Clear the dynamic variable cache - should be called before each request
     */
    clearDynamicCache() {
        this.dynamicGenerator.clearCache();
    }

    /**
     * Extract dynamic variable names from a template
     * @param {string} template - Template string to extract from
     * @returns {Array<{name: string, params: string|null}>} Array of dynamic variable info
     */
    extractDynamicVariableNames(template) {
        if (!template || typeof template !== 'string') {
            return [];
        }

        const matches = [];
        let match;

        this.DYNAMIC_VARIABLE_PATTERN.lastIndex = 0;

        while ((match = this.DYNAMIC_VARIABLE_PATTERN.exec(template)) !== null) {
            matches.push({
                name: match[1],
                params: match[2] || null
            });
        }

        return matches;
    }

    getPreview(template, variables = {}) {
        const variableNames = this.extractVariableNames(template);
        const dynamicVars = this.extractDynamicVariableNames(template);
        const missingVariables = variableNames.filter(name => !(name in variables));

        // For preview, replace dynamic variables with placeholders (not actual values)
        let preview = template;

        // Replace dynamic variables with placeholders
        preview = preview.replace(this.DYNAMIC_VARIABLE_PATTERN, (match, variableName, params) => {
            if (this.dynamicGenerator.isDynamicVariable(variableName)) {
                return this.dynamicGenerator.getPlaceholder(variableName, params || null);
            }
            return match;
        });

        // Replace regular variables with their values
        preview = preview.replace(this.VARIABLE_PATTERN, (match, variableName) => {
            const value = variables[variableName];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            return match;
        });

        return {
            preview,
            missingVariables,
            foundVariables: variableNames.filter(name => name in variables),
            dynamicVariables: dynamicVars.map(v => v.name)
        };
    }
}