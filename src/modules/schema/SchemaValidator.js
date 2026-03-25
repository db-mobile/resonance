/**
 * @fileoverview Schema validation and inference utilities
 * @module schema/SchemaValidator
 */

/**
 * Validates JSON data against JSON Schema and infers schemas from data
 */
export class SchemaValidator {
    /**
     * Validates data against a JSON Schema
     * 
     * @param {*} data - The data to validate
     * @param {Object} schema - JSON Schema to validate against
     * @returns {Object} Validation result { valid: boolean, errors: Array }
     */
    validate(data, schema) {
        if (!schema || typeof schema !== 'object') {
            return { valid: true, errors: [] };
        }

        const errors = [];
        this._validateNode(data, schema, '', errors);
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Recursively validates a node against its schema
     * @private
     */
    _validateNode(data, schema, path, errors) {
        // Handle nullable
        if (data === null) {
            if (schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'))) {
                return;
            }
            if (schema.type && schema.type !== 'null') {
                errors.push({
                    path: path || '/',
                    message: `Expected ${schema.type}, got null`,
                    keyword: 'type'
                });
            }
            return;
        }

        // Type validation
        if (schema.type) {
            const actualType = this._getType(data);
            const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
            
            if (!expectedTypes.includes(actualType)) {
                errors.push({
                    path: path || '/',
                    message: `Expected ${expectedTypes.join(' | ')}, got ${actualType}`,
                    keyword: 'type'
                });
                return;
            }
        }

        // Object validation
        if (typeof data === 'object' && !Array.isArray(data) && data !== null) {
            this._validateObject(data, schema, path, errors);
        }

        // Array validation
        if (Array.isArray(data)) {
            this._validateArray(data, schema, path, errors);
        }

        // String validation
        if (typeof data === 'string') {
            this._validateString(data, schema, path, errors);
        }

        // Number validation
        if (typeof data === 'number') {
            this._validateNumber(data, schema, path, errors);
        }

        // Enum validation
        if (schema.enum && !schema.enum.includes(data)) {
            errors.push({
                path: path || '/',
                message: `Value must be one of: ${schema.enum.join(', ')}`,
                keyword: 'enum'
            });
        }
    }

    /**
     * Validates an object against schema properties
     * @private
     */
    _validateObject(data, schema, path, errors) {
        // Required properties
        if (schema.required && Array.isArray(schema.required)) {
            for (const prop of schema.required) {
                if (!(prop in data)) {
                    errors.push({
                        path: `${path}/${prop}`,
                        message: `Missing required property: ${prop}`,
                        keyword: 'required'
                    });
                }
            }
        }

        // Property validation
        if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                if (key in data) {
                    this._validateNode(data[key], propSchema, `${path}/${key}`, errors);
                }
            }
        }

        // Additional properties
        if (schema.additionalProperties === false && schema.properties) {
            const allowedKeys = Object.keys(schema.properties);
            for (const key of Object.keys(data)) {
                if (!allowedKeys.includes(key)) {
                    errors.push({
                        path: `${path}/${key}`,
                        message: `Additional property not allowed: ${key}`,
                        keyword: 'additionalProperties'
                    });
                }
            }
        }
    }

    /**
     * Validates an array against schema items
     * @private
     */
    _validateArray(data, schema, path, errors) {
        // Min/max items
        if (schema.minItems !== undefined && data.length < schema.minItems) {
            errors.push({
                path: path || '/',
                message: `Array must have at least ${schema.minItems} items`,
                keyword: 'minItems'
            });
        }

        if (schema.maxItems !== undefined && data.length > schema.maxItems) {
            errors.push({
                path: path || '/',
                message: `Array must have at most ${schema.maxItems} items`,
                keyword: 'maxItems'
            });
        }

        // Items validation
        if (schema.items) {
            data.forEach((item, index) => {
                this._validateNode(item, schema.items, `${path}/${index}`, errors);
            });
        }
    }

    /**
     * Validates a string against schema constraints
     * @private
     */
    _validateString(data, schema, path, errors) {
        if (schema.minLength !== undefined && data.length < schema.minLength) {
            errors.push({
                path: path || '/',
                message: `String must be at least ${schema.minLength} characters`,
                keyword: 'minLength'
            });
        }

        if (schema.maxLength !== undefined && data.length > schema.maxLength) {
            errors.push({
                path: path || '/',
                message: `String must be at most ${schema.maxLength} characters`,
                keyword: 'maxLength'
            });
        }

        if (schema.pattern) {
            try {
                const regex = new RegExp(schema.pattern);
                if (!regex.test(data)) {
                    errors.push({
                        path: path || '/',
                        message: `String does not match pattern: ${schema.pattern}`,
                        keyword: 'pattern'
                    });
                }
            } catch {
                // Invalid regex pattern in schema
            }
        }

        // Format validation (basic)
        if (schema.format) {
            const formatError = this._validateFormat(data, schema.format);
            if (formatError) {
                errors.push({
                    path: path || '/',
                    message: formatError,
                    keyword: 'format'
                });
            }
        }
    }

    /**
     * Validates a number against schema constraints
     * @private
     */
    _validateNumber(data, schema, path, errors) {
        if (schema.minimum !== undefined && data < schema.minimum) {
            errors.push({
                path: path || '/',
                message: `Value must be >= ${schema.minimum}`,
                keyword: 'minimum'
            });
        }

        if (schema.maximum !== undefined && data > schema.maximum) {
            errors.push({
                path: path || '/',
                message: `Value must be <= ${schema.maximum}`,
                keyword: 'maximum'
            });
        }

        if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
            errors.push({
                path: path || '/',
                message: `Value must be > ${schema.exclusiveMinimum}`,
                keyword: 'exclusiveMinimum'
            });
        }

        if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
            errors.push({
                path: path || '/',
                message: `Value must be < ${schema.exclusiveMaximum}`,
                keyword: 'exclusiveMaximum'
            });
        }

        if (schema.type === 'integer' && !Number.isInteger(data)) {
            errors.push({
                path: path || '/',
                message: 'Value must be an integer',
                keyword: 'type'
            });
        }
    }

    /**
     * Validates string format
     * @private
     */
    _validateFormat(data, format) {
        const formats = {
            'email': /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            'uri': /^https?:\/\/.+/,
            'url': /^https?:\/\/.+/,
            'uuid': /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            'date': /^\d{4}-\d{2}-\d{2}$/,
            'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            'time': /^\d{2}:\d{2}:\d{2}/,
            'ipv4': /^(\d{1,3}\.){3}\d{1,3}$/,
            'ipv6': /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i
        };

        if (formats[format] && !formats[format].test(data)) {
            return `Invalid ${format} format`;
        }

        return null;
    }

    /**
     * Gets the JSON Schema type of a value
     * @private
     */
    _getType(value) {
        if (value === null) {
            return 'null';
        }
        if (Array.isArray(value)) {
            return 'array';
        }
        if (typeof value === 'number') {
            return Number.isInteger(value) ? 'integer' : 'number';
        }
        return typeof value;
    }

    /**
     * Infers a JSON Schema from sample data
     * 
     * @param {*} data - Sample data to infer schema from
     * @returns {Object} Inferred JSON Schema
     */
    inferSchema(data) {
        return this._inferNode(data);
    }

    /**
     * Recursively infers schema for a node
     * @private
     */
    _inferNode(data) {
        if (data === null) {
            return { type: 'null' };
        }

        if (Array.isArray(data)) {
            return this._inferArray(data);
        }

        if (typeof data === 'object') {
            return this._inferObject(data);
        }

        if (typeof data === 'string') {
            return this._inferString(data);
        }

        if (typeof data === 'number') {
            return { type: Number.isInteger(data) ? 'integer' : 'number' };
        }

        if (typeof data === 'boolean') {
            return { type: 'boolean' };
        }

        return {};
    }

    /**
     * Infers schema for an object
     * @private
     */
    _inferObject(data) {
        const schema = {
            type: 'object',
            properties: {},
            required: []
        };

        for (const [key, value] of Object.entries(data)) {
            schema.properties[key] = this._inferNode(value);
            schema.required.push(key);
        }

        if (schema.required.length === 0) {
            delete schema.required;
        }

        return schema;
    }

    /**
     * Infers schema for an array
     * @private
     */
    _inferArray(data) {
        const schema = {
            type: 'array'
        };

        if (data.length > 0) {
            // Infer items schema from first element
            // Could be enhanced to merge schemas from all elements
            schema.items = this._inferNode(data[0]);
        }

        return schema;
    }

    /**
     * Infers schema for a string, detecting common formats
     * @private
     */
    _inferString(data) {
        const schema = { type: 'string' };

        // Detect common formats
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)) {
            schema.format = 'email';
        } else if (/^https?:\/\/.+/.test(data)) {
            schema.format = 'uri';
        } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
            schema.format = 'uuid';
        } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(data)) {
            schema.format = 'date-time';
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
            schema.format = 'date';
        }

        return schema;
    }

    /**
     * Formats validation errors for display
     * 
     * @param {Array} errors - Array of validation errors
     * @returns {string} Formatted error message
     */
    formatErrors(errors) {
        if (!errors || errors.length === 0) {
            return '';
        }

        return errors.map(err => `${err.path}: ${err.message}`).join('\n');
    }
}
