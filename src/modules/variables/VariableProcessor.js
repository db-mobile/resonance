import { DynamicVariableGenerator } from './DynamicVariableGenerator.js';

export class VariableProcessor {
    constructor() {
        this.VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*\}\}/g;
        this.DYNAMIC_VARIABLE_PATTERN = /\{\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\s*\}\}/g;
        this.MAX_RESOLUTION_PASSES = 10;
        this.dynamicGenerator = new DynamicVariableGenerator();
    }

    processTemplate(template, variables = {}) {
        if (!template || typeof template !== 'string') {
            return template;
        }

        let result = template;
        for (let pass = 0; pass < this.MAX_RESOLUTION_PASSES; pass++) {
            const next = this._resolvePass(result, variables);
            if (next === result) {
                return result;
            }
            result = next;
        }

        return result;
    }

    /**
     * Run one substitution pass over the input: dynamic variables first, then static.
     * Unknown variables are left verbatim so callers can detect and preserve them.
     * @param {string} input - String to substitute into
     * @param {Object} variables - Static variable name/value map
     * @returns {string} Input with one round of substitutions applied
     */
    _resolvePass(input, variables) {
        const withDynamic = input.replace(this.DYNAMIC_VARIABLE_PATTERN, (match, variableName, params) => {
            if (this.dynamicGenerator.isDynamicVariable(variableName)) {
                const value = this.dynamicGenerator.generate(variableName, params || null);
                return String(value);
            }
            return match;
        });

        return withDynamic.replace(this.VARIABLE_PATTERN, (match, variableName) => {
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

        return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
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
        const staticNames = new Set();
        const dynamicNames = new Set();

        let preview = template;
        for (let pass = 0; pass < this.MAX_RESOLUTION_PASSES; pass++) {
            this.extractVariableNames(preview).forEach(name => staticNames.add(name));
            this.extractDynamicVariableNames(preview).forEach(v => dynamicNames.add(v.name));

            const next = this._previewPass(preview, variables);
            if (next === preview) {
                break;
            }
            preview = next;
        }

        const variableNames = Array.from(staticNames);

        return {
            preview,
            missingVariables: variableNames.filter(name => !(name in variables)),
            foundVariables: variableNames.filter(name => name in variables),
            dynamicVariables: Array.from(dynamicNames)
        };
    }

    /**
     * Run one preview substitution pass: dynamic variables become placeholders,
     * static variables become their values, unknown variables stay verbatim.
     * @param {string} input - String to substitute into
     * @param {Object} variables - Static variable name/value map
     * @returns {string} Input with one round of preview substitutions applied
     */
    _previewPass(input, variables) {
        const withDynamic = input.replace(this.DYNAMIC_VARIABLE_PATTERN, (match, variableName, params) => {
            if (this.dynamicGenerator.isDynamicVariable(variableName)) {
                return this.dynamicGenerator.getPlaceholder(variableName, params || null);
            }
            return match;
        });

        return withDynamic.replace(this.VARIABLE_PATTERN, (match, variableName) => {
            const value = variables[variableName];
            if (value !== undefined && value !== null) {
                return String(value);
            }
            return match;
        });
    }
}