/**
 * Handles OpenAPI schema processing, $ref resolution, and example generation
 */
class SchemaProcessor {
    constructor() {
        this.currentOpenApiSpec = null;
    }

    /**
     * Set the current OpenAPI spec for $ref resolution
     */
    setCurrentSpec(spec) {
        this.currentOpenApiSpec = spec;
    }

    /**
     * Resolve a $ref reference to its actual schema
     */
    resolveSchemaRef(schemaOrRef, openApiSpec = null) {
        const spec = openApiSpec || this.currentOpenApiSpec;
        if (!schemaOrRef || !spec) {
            return schemaOrRef;
        }

        // If it's a $ref, resolve it
        if (schemaOrRef.$ref) {
            console.log('MAIN PROCESS: Resolving $ref:', schemaOrRef.$ref);

            // Parse the $ref path (e.g., "#/components/schemas/RestRefreshTokensRequest")
            const refPath = schemaOrRef.$ref.split('/').slice(1); // Remove the '#' part

            let resolved = spec;
            for (const part of refPath) {
                if (resolved && resolved[part]) {
                    resolved = resolved[part];
                } else {
                    console.log('MAIN PROCESS: Failed to resolve $ref path:', refPath, 'at part:', part);
                    return schemaOrRef; // Return original if resolution fails
                }
            }

            console.log('MAIN PROCESS: Resolved $ref to:', resolved);

            // Recursively resolve any nested $refs
            return this.resolveSchemaRefs(resolved, spec);
        }

        // If it's not a $ref, return as is
        return schemaOrRef;
    }

    /**
     * Recursively resolve all $refs in a schema
     */
    resolveSchemaRefs(schema, openApiSpec = null) {
        if (!schema || typeof schema !== 'object') {
            return schema;
        }

        // If this schema has a $ref, resolve it first
        if (schema.$ref) {
            return this.resolveSchemaRef(schema, openApiSpec);
        }

        // Create a copy to avoid modifying the original
        const resolved = { ...schema };

        // Recursively resolve $refs in properties
        if (resolved.properties) {
            resolved.properties = { ...resolved.properties };
            for (const [key, prop] of Object.entries(resolved.properties)) {
                resolved.properties[key] = this.resolveSchemaRefs(prop, openApiSpec);
            }
        }

        // Recursively resolve $refs in array items
        if (resolved.items) {
            resolved.items = this.resolveSchemaRefs(resolved.items, openApiSpec);
        }

        // Handle allOf, oneOf, anyOf
        ['allOf', 'oneOf', 'anyOf'].forEach(key => {
            if (resolved[key] && Array.isArray(resolved[key])) {
                resolved[key] = resolved[key].map(item => this.resolveSchemaRefs(item, openApiSpec));
            }
        });

        return resolved;
    }

    /**
     * Parse request body from OpenAPI specification
     */
    parseRequestBody(requestBody) {
        console.log('MAIN PROCESS: parseRequestBody called with:', requestBody);

        if (!requestBody) {
            console.log('MAIN PROCESS: No requestBody provided');
            return null;
        }

        const content = requestBody.content;
        if (!content) {
            console.log('MAIN PROCESS: No content in requestBody');
            return null;
        }

        // Check if request body is required
        const isRequired = requestBody.required === true;
        console.log('MAIN PROCESS: Request body required:', isRequired);

        // Try to find JSON content first
        const jsonContent = content['application/json'];
        console.log('MAIN PROCESS: JSON content found:', !!jsonContent);
        if (jsonContent) {
            console.log('MAIN PROCESS: JSON content schema:', jsonContent.schema);
            console.log('MAIN PROCESS: JSON content example:', jsonContent.example);
        }

        if (jsonContent && jsonContent.schema) {
            console.log('MAIN PROCESS: Resolving schema refs...');
            const resolvedSchema = this.resolveSchemaRefs(jsonContent.schema);
            console.log('MAIN PROCESS: Resolved schema:', resolvedSchema);

            console.log('MAIN PROCESS: Generating example from resolved schema...');
            const generatedExample = jsonContent.example || this.generateExampleFromSchema(resolvedSchema);
            console.log('MAIN PROCESS: Generated example result:', generatedExample);

            const finalResult = {
                contentType: 'application/json',
                schema: resolvedSchema,
                required: isRequired,
                example: (generatedExample === null || generatedExample === undefined) ?
                    JSON.stringify({ "data": "example" }, null, 2) : generatedExample
            };

            console.log('MAIN PROCESS: Final requestBody result:', finalResult);
            return finalResult;
        }

        // Fallback to first available content type
        const firstContentType = Object.keys(content)[0];
        const firstContent = content[firstContentType];

        const resolvedSchema = this.resolveSchemaRefs(firstContent.schema);
        const generatedExample = firstContent.example || this.generateExampleFromSchema(resolvedSchema);

        return {
            contentType: firstContentType,
            schema: resolvedSchema,
            required: isRequired,
            example: (generatedExample === null || generatedExample === undefined) ?
                JSON.stringify({ "data": "example" }, null, 2) : generatedExample
        };
    }

    /**
     * Generate example JSON from OpenAPI schema
     */
    generateExampleFromSchema(schema, depth = 0) {
        console.log(`MAIN PROCESS: [Depth ${depth}] generateExampleFromSchema called with:`, schema);

        if (!schema) {
            console.log('MAIN PROCESS: No schema, returning basic template');
            return JSON.stringify({ "data": "example" }, null, 2);
        }

        if (schema.example !== undefined && schema.example !== null) {
            console.log('MAIN PROCESS: Schema has example, using it:', schema.example);
            if (depth === 0) {
                return JSON.stringify(schema.example, null, 2);
            }
            return schema.example;
        }

        console.log(`MAIN PROCESS: [Depth ${depth}] Schema type:`, schema.type);
        console.log(`MAIN PROCESS: [Depth ${depth}] Schema properties:`, schema.properties);

        // Recursive function to generate example from schema
        const generateValue = (propSchema, propName = '', currentDepth = 0) => {
            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generating value for property "${propName}" with schema:`, propSchema);

            if (!propSchema) {
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] No propSchema for ${propName}`);
                return 'no-schema';
            }

            // Handle $ref if present
            if (propSchema.$ref) {
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Found $ref, resolving:`, propSchema.$ref);
                const resolved = this.resolveSchemaRef(propSchema);
                if (resolved && resolved !== propSchema) {
                    return generateValue(resolved, propName, currentDepth);
                }
                return 'ref-placeholder';
            }

            // If schema has properties but no type, assume it's an object
            if (propSchema.properties && !propSchema.type) {
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Schema has properties but no type, assuming object for ${propName}`);
                propSchema = { ...propSchema, type: 'object' };
            }

            if (propSchema.example !== undefined && propSchema.example !== null) {
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Using example for ${propName}:`, propSchema.example);
                return propSchema.example;
            }

            if (propSchema.default !== undefined) {
                console.log(`MAIN PROCESS: [Depth ${currentDepth}] Using default for ${propName}:`, propSchema.default);
                return propSchema.default;
            }

            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Property ${propName} has type:`, propSchema.type);

            switch (propSchema.type) {
                case 'string':
                    return this._generateStringExample(propSchema, propName);

                case 'number':
                case 'integer':
                    return this._generateNumberExample(propSchema, propName);

                case 'boolean':
                    return false;

                case 'array':
                    console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generating array for ${propName}, items schema:`, propSchema.items);
                    if (propSchema.items) {
                        const itemExample = generateValue(propSchema.items, propName + '_item', currentDepth + 1);
                        console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generated array item:`, itemExample);
                        return [itemExample];
                    }
                    return [];

                case 'object':
                    console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generating object for ${propName}, properties:`, propSchema.properties);
                    if (propSchema.properties) {
                        const obj = {};
                        for (const [key, valueProp] of Object.entries(propSchema.properties)) {
                            console.log(`MAIN PROCESS: [Depth ${currentDepth}] Processing object property ${key}:`, valueProp);
                            obj[key] = generateValue(valueProp, key, currentDepth + 1);
                        }
                        console.log(`MAIN PROCESS: [Depth ${currentDepth}] Generated object for ${propName}:`, obj);
                        return obj;
                    }
                    console.log(`MAIN PROCESS: [Depth ${currentDepth}] No properties for object ${propName}, returning empty object`);
                    return {};

                default:
                    console.log(`MAIN PROCESS: [Depth ${currentDepth}] Unknown type for ${propName}:`, propSchema.type);
                    return 'unknown-type';
            }
        };

        // Generate example based on schema type
        let example;

        console.log(`MAIN PROCESS: [Depth ${depth}] Root schema processing...`);
        if (schema.type === 'object' && schema.properties) {
            console.log(`MAIN PROCESS: [Depth ${depth}] Processing object schema with properties:`, Object.keys(schema.properties));
            example = generateValue(schema, 'root', depth);
        } else if (schema.properties && !schema.type) {
            // Schema has properties but no explicit type - assume object
            console.log(`MAIN PROCESS: [Depth ${depth}] Processing schema with properties but no type, assuming object:`, Object.keys(schema.properties));
            schema.type = 'object';
            example = generateValue(schema, 'root', depth);
        } else if (schema.type === 'array') {
            console.log(`MAIN PROCESS: [Depth ${depth}] Processing array schema`);
            example = generateValue(schema, 'root', depth);
        } else if (schema.type) {
            console.log(`MAIN PROCESS: [Depth ${depth}] Processing schema with type:`, schema.type);
            example = generateValue(schema, 'root', depth);
        } else {
            console.log(`MAIN PROCESS: [Depth ${depth}] No type or properties found, returning null for better fallback handling`);
            return null;
        }

        // Ensure we never return null or undefined
        if (example === null || example === undefined) {
            example = { "data": "example" };
        }

        console.log(`MAIN PROCESS: [Depth ${depth}] Final generated example:`, example);

        // Return properly formatted JSON only at the top level
        if (depth === 0) {
            if (typeof example === 'string') {
                return example;
            } else {
                const result = JSON.stringify(example, null, 2);
                console.log(`MAIN PROCESS: [Depth ${depth}] Returning JSON result:`, result);
                return result;
            }
        } else {
            return example;
        }
    }

    /**
     * Generate example string value based on property name and format
     */
    _generateStringExample(propSchema, propName) {
        if (propSchema.format === 'email') return 'user@example.com';
        if (propSchema.format === 'date') return '2024-01-01';
        if (propSchema.format === 'date-time') return '2024-01-01T12:00:00Z';
        if (propSchema.format === 'uuid') return '123e4567-e89b-12d3-a456-426614174000';
        if (propSchema.enum) return propSchema.enum[0];

        // Generate more realistic and varied sample strings
        const sampleStrings = [
            'nisi', 'est magna Excepteur ipsum', 'officia', 'dolor ea adipisicing cillum',
            'Lorem ipsum', 'consectetur', 'adipiscing elit', 'sed do eiusmod',
            'tempor incididunt', 'labore et dolore', 'magna aliqua'
        ];

        const name = propName.toLowerCase();
        if (name.includes('name')) return 'Example Name';
        if (name.includes('title')) return 'Example Title';
        if (name.includes('description')) return 'Example description text';
        if (name.includes('id')) return 'example-id-123';
        if (name.includes('email')) return 'user@example.com';
        if (name.includes('password')) return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
        if (name.includes('newpassword')) return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
        if (name.includes('confirmpassword')) return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
        if (name.includes('type')) return sampleStrings[0];
        if (name.includes('phone')) return '+1-555-0123';
        if (name.includes('address')) return '123 Main Street';
        if (name.includes('city')) return 'New York';
        if (name.includes('country')) return 'United States';
        if (name.includes('token')) return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
        if (name.includes('url')) return 'https://example.com';
        if (name.includes('code')) return 'ABC123';

        // Return a varied sample string
        return sampleStrings[Math.floor(Math.random() * sampleStrings.length)];
    }

    /**
     * Generate example number value based on schema constraints
     */
    _generateNumberExample(propSchema, propName) {
        if (propSchema.minimum !== undefined) return propSchema.minimum;
        if (propSchema.maximum !== undefined && propSchema.minimum !== undefined) {
            return Math.floor((propSchema.minimum + propSchema.maximum) / 2);
        }
        if (propSchema.enum) return propSchema.enum[0];
        if (propName.toLowerCase().includes('id')) return 1;
        if (propName.toLowerCase().includes('count')) return 10;
        if (propName.toLowerCase().includes('price')) return 99.99;
        if (propName.toLowerCase().includes('age')) return 25;
        return propSchema.type === 'integer' ? 42 : 42.5;
    }
}

export default SchemaProcessor;
