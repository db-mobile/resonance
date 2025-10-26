export class VariableProcessor {
    constructor() {
        this.VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    }

    processTemplate(template, variables = {}) {
        if (!template || typeof template !== 'string') {
            return template;
        }

        return template.replace(this.VARIABLE_PATTERN, (match, variableName) => {
            const value = variables[variableName];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            return match;
        });
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