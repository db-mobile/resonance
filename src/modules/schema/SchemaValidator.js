/**
 * @fileoverview Native JSON Schema validation adapter and local schema inference
 * @module schema/SchemaValidator
 */

export class SchemaValidator {
    constructor(backendAPI = null) {
        this.backendAPI = backendAPI;
    }

    /** @returns {Promise<{valid: boolean, errors: Array}>} */
    async check(schema) {
        return this._call('check', schema);
    }

    /** @returns {Promise<{valid: boolean, schemaValid: boolean, errors: Array}>} */
    async validate(data, schema) {
        return this._call('validate', schema, data);
    }

    async _call(method, ...args) {
        try {
            const api = this.backendAPI ?? globalThis.window?.backendAPI;
            if (!api?.schema?.[method]) {
                throw new Error('Native schema validator is unavailable');
            }
            return await api.schema[method](...args);
        } catch (error) {
            return {
                valid: false,
                schemaValid: false,
                errors: [{ path: '/', keyword: 'backend', message: error?.message || String(error) }]
            };
        }
    }

    /**
     * @param {*} data
     * @returns {Object}
     */
    inferSchema(data) {
        return this._inferNode(data);
    }

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

    _inferArray(data) {
        const schema = {
            type: 'array'
        };

        if (data.length > 0) {
            schema.items = this._inferNode(data[0]);
        }

        return schema;
    }

    _inferString(data) {
        const schema = { type: 'string' };

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
}
