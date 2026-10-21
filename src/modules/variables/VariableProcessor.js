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
     * @param {string} input
     * @param {Object} variables
     * @returns {string}
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

    /**
     * @param {*} value
     * @param {Object} [variables={}]
     * @returns {string[]}
     */
    extractUnresolvedVariableNames(value, variables = {}) {
        const unresolved = new Set();

        const visit = (input) => {
            if (typeof input === 'string') {
                this.extractVariableNames(input).forEach(name => {
                    if (!(name in variables)) {
                        unresolved.add(name);
                    }
                });
                this.extractDynamicVariableNames(input).forEach(v => {
                    if (!this.dynamicGenerator.isDynamicVariable(v.name)) {
                        unresolved.add(`$${v.name}`);
                    }
                });
            } else if (Array.isArray(input)) {
                input.forEach(visit);
            } else if (input && typeof input === 'object') {
                Object.entries(input).forEach(([key, val]) => {
                    visit(key);
                    visit(val);
                });
            }
        };

        visit(value);
        return Array.from(unresolved);
    }

    isValidVariableName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name);
    }

    clearDynamicCache() {
        this.dynamicGenerator.clearCache();
    }

    /**
     * @param {string} template
     * @returns {Array<{name: string, params: string|null}>}
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
}