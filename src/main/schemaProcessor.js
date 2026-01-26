/**
 * @fileoverview OpenAPI schema processing and example generation
 * @module main/schemaProcessor
 */

/**
 * Processes OpenAPI schemas and generates request body examples
 *
 * @class
 * @classdesc Handles resolution of OpenAPI $ref references, generates example
 * request bodies from schemas, and processes complex schema structures including
 * nested objects, arrays, and schema composition (allOf, oneOf, anyOf).
 */
class SchemaProcessor {
    /**
     * Creates a SchemaProcessor instance
     */
    constructor() {
        /** @type {Object|null} The currently active OpenAPI specification */
        this.currentOpenApiSpec = null;
    }

    /**
     * Sets the current OpenAPI specification for reference resolution
     *
     * @param {Object} spec - The OpenAPI specification object
     * @returns {void}
     */
    setOpenApiSpec(spec) {
        this.currentOpenApiSpec = spec;
    }

    /**
     * Resolves a single $ref reference in an OpenAPI schema
     *
     * Follows JSON Reference syntax (e.g., "#/components/schemas/User") and
     * recursively resolves nested references.
     *
     * @param {Object} schemaOrRef - Schema object that may contain a $ref property
     * @param {Object} [openApiSpec=null] - OpenAPI spec to use, defaults to current spec
     * @returns {Object} The resolved schema object
     */
    resolveSchemaRef(schemaOrRef, openApiSpec = null) {
        const spec = openApiSpec || this.currentOpenApiSpec;
        if (!schemaOrRef || !spec) {
            return schemaOrRef;
        }

        if (schemaOrRef.$ref) {
            const refPath = schemaOrRef.$ref.split('/').slice(1); // Remove the '#' part

            let resolved = spec;
            for (const part of refPath) {
                if (resolved && resolved[part]) {
                    resolved = resolved[part];
                } else {
                    return schemaOrRef;
                }
            }

            return this.resolveSchemaRefs(resolved, spec);
        }

        return schemaOrRef;
    }

    /**
     * Recursively resolves all $ref references in a schema
     *
     * Handles complex schemas including objects with properties, arrays with items,
     * and schema composition keywords (allOf, oneOf, anyOf).
     *
     * @param {Object} schema - The schema object to process
     * @param {Object} [openApiSpec=null] - OpenAPI spec to use, defaults to current spec
     * @returns {Object} The fully resolved schema with all references replaced
     */
    resolveSchemaRefs(schema, openApiSpec = null) {
        if (!schema || typeof schema !== 'object') {
            return schema;
        }

        if (schema.$ref) {
            return this.resolveSchemaRef(schema, openApiSpec);
        }

        const resolved = { ...schema };

        if (resolved.properties) {
            resolved.properties = { ...resolved.properties };
            for (const [key, prop] of Object.entries(resolved.properties)) {
                resolved.properties[key] = this.resolveSchemaRefs(prop, openApiSpec);
            }
        }

        if (resolved.items) {
            resolved.items = this.resolveSchemaRefs(resolved.items, openApiSpec);
        }

        ['allOf', 'oneOf', 'anyOf'].forEach(key => {
            if (resolved[key] && Array.isArray(resolved[key])) {
                resolved[key] = resolved[key].map(item => this.resolveSchemaRefs(item, openApiSpec));
            }
        });

        return resolved;
    }

    /**
     * Parses OpenAPI request body and generates example data
     *
     * Extracts the schema from requestBody content (prefers application/json),
     * resolves all references, and generates an example request body.
     *
     * @param {Object} requestBody - OpenAPI requestBody object
     * @returns {Object|null} Parsed request body with schema and example, or null
     * @property {string} contentType - The content type (e.g., 'application/json')
     * @property {Object} schema - The resolved schema object
     * @property {boolean} required - Whether the request body is required
     * @property {string} example - JSON string example of the request body
     */
    parseRequestBody(requestBody) {
        if (!requestBody) {
            return null;
        }

        const {content} = requestBody;
        if (!content) {
            return null;
        }

        const isRequired = requestBody.required === true;

        const jsonContent = content['application/json'];

        if (jsonContent && jsonContent.schema) {
            const resolvedSchema = this.resolveSchemaRefs(jsonContent.schema);

            const generatedExample = jsonContent.example || this.generateExampleFromSchema(resolvedSchema);

            const finalResult = {
                contentType: 'application/json',
                schema: resolvedSchema,
                required: isRequired,
                example: (generatedExample === null || generatedExample === undefined) ?
                    JSON.stringify({ 'data': 'example' }, null, 2) : generatedExample
            };

            return finalResult;
        }

        const firstContentType = Object.keys(content)[0];
        const firstContent = content[firstContentType];

        const resolvedSchema = this.resolveSchemaRefs(firstContent.schema);
        const generatedExample = firstContent.example || this.generateExampleFromSchema(resolvedSchema);

        return {
            contentType: firstContentType,
            schema: resolvedSchema,
            required: isRequired,
            example: (generatedExample === null || generatedExample === undefined) ?
                JSON.stringify({ 'data': 'example' }, null, 2) : generatedExample
        };
    }

    /**
     * Generates example data from an OpenAPI schema
     *
     * Creates realistic example values based on schema type, format, property names,
     * and constraints. Supports nested objects, arrays, and all primitive types.
     *
     * @param {Object} schema - The OpenAPI schema object
     * @param {number} [depth=0] - Current nesting depth (0 = root level)
     * @returns {string|Object|Array|null} Generated example (JSON string at depth 0, value otherwise)
     */
    generateExampleFromSchema(schema, depth = 0) {
        if (!schema) {
            return JSON.stringify({ 'data': 'example' }, null, 2);
        }

        if (schema.example !== undefined && schema.example !== null) {
            if (depth === 0) {
                return JSON.stringify(schema.example, null, 2);
            }
            return schema.example;
        }

        const generateValue = (propSchema, propName = '', currentDepth = 0) => {
            if (!propSchema) {
                return 'no-schema';
            }

            if (propSchema.$ref) {
                const resolved = this.resolveSchemaRef(propSchema);
                if (resolved && resolved !== propSchema) {
                    return generateValue(resolved, propName, currentDepth);
                }
                return 'ref-placeholder';
            }

            if (propSchema.properties && !propSchema.type) {
                propSchema = { ...propSchema, type: 'object' };
            }

            if (propSchema.example !== undefined && propSchema.example !== null) {
                return propSchema.example;
            }

            if (propSchema.default !== undefined) {
                return propSchema.default;
            }

            switch (propSchema.type) {
                case 'string':
                    return this._generateStringExample(propSchema, propName);

                case 'number':
                case 'integer':
                    return this._generateNumberExample(propSchema, propName);

                case 'boolean':
                    return false;

                case 'array':
                    if (propSchema.items) {
                        const itemExample = generateValue(propSchema.items, `${propName  }_item`, currentDepth + 1);
                        return [itemExample];
                    }
                    return [];

                case 'object':
                    if (propSchema.properties) {
                        const obj = {};
                        for (const [key, valueProp] of Object.entries(propSchema.properties)) {
                            obj[key] = generateValue(valueProp, key, currentDepth + 1);
                        }
                        return obj;
                    }
                    return {};

                default:
                    return 'unknown-type';
            }
        };

        let example;

        if (schema.type === 'object' && schema.properties) {
            example = generateValue(schema, 'root', depth);
        } else if (schema.properties && !schema.type) {
            schema.type = 'object';
            example = generateValue(schema, 'root', depth);
        } else if (schema.type === 'array') {
            example = generateValue(schema, 'root', depth);
        } else if (schema.type) {
            example = generateValue(schema, 'root', depth);
        } else {
            return null;
        }

        if (example === null || example === undefined) {
            example = { 'data': 'example' };
        }

        if (depth === 0) {
            if (typeof example === 'string') {
                return example;
            } 
                const result = JSON.stringify(example, null, 2);
                return result;
            
        } 
            return example;
        
    }

    /**
     * Generates example string values based on schema format and property name
     *
     * Uses heuristics to generate realistic examples (e.g., email format returns
     * "user@example.com", properties named "name" return "Example Name").
     *
     * @private
     * @param {Object} propSchema - The property schema
     * @param {string} propName - The property name (used for intelligent defaults)
     * @returns {string} Generated example string
     */
    _generateStringExample(propSchema, propName) {
        if (propSchema.format === 'email') {return 'user@example.com';}
        if (propSchema.format === 'date') {return '2024-01-01';}
        if (propSchema.format === 'date-time') {return '2024-01-01T12:00:00Z';}
        if (propSchema.format === 'uuid') {return '123e4567-e89b-12d3-a456-426614174000';}
        if (propSchema.enum) {return propSchema.enum[0];}

        const sampleStrings = [
            'nisi', 'est magna Excepteur ipsum', 'officia', 'dolor ea adipisicing cillum',
            'Lorem ipsum', 'consectetur', 'adipiscing elit', 'sed do eiusmod',
            'tempor incididunt', 'labore et dolore', 'magna aliqua'
        ];

        const name = propName.toLowerCase();
        if (name.includes('name')) {return 'Example Name';}
        if (name.includes('title')) {return 'Example Title';}
        if (name.includes('description')) {return 'Example description text';}
        if (name.includes('id')) {return 'example-id-123';}
        if (name.includes('email')) {return 'user@example.com';}
        if (name.includes('password')) {return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];}
        if (name.includes('newpassword')) {return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];}
        if (name.includes('confirmpassword')) {return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];}
        if (name.includes('type')) {return sampleStrings[0];}
        if (name.includes('phone')) {return '+1-555-0123';}
        if (name.includes('address')) {return '123 Main Street';}
        if (name.includes('city')) {return 'New York';}
        if (name.includes('country')) {return 'United States';}
        if (name.includes('token')) {return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';}
        if (name.includes('url')) {return 'https://example.com';}
        if (name.includes('code')) {return 'ABC123';}

        return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
    }

    /**
     * Generates example number values based on schema constraints and property name
     *
     * Respects minimum/maximum constraints and uses property name hints
     * (e.g., "price" returns 99.99, "age" returns 25).
     *
     * @private
     * @param {Object} propSchema - The property schema
     * @param {string} propName - The property name (used for intelligent defaults)
     * @returns {number} Generated example number
     */
    _generateNumberExample(propSchema, propName) {
        if (propSchema.minimum !== undefined) {return propSchema.minimum;}
        if (propSchema.maximum !== undefined && propSchema.minimum !== undefined) {
            return Math.floor((propSchema.minimum + propSchema.maximum) / 2);
        }
        if (propSchema.enum) {return propSchema.enum[0];}
        if (propName.toLowerCase().includes('id')) {return 1;}
        if (propName.toLowerCase().includes('count')) {return 10;}
        if (propName.toLowerCase().includes('price')) {return 99.99;}
        if (propName.toLowerCase().includes('age')) {return 25;}
        return propSchema.type === 'integer' ? 42 : 42.5;
    }
}

export default SchemaProcessor;
