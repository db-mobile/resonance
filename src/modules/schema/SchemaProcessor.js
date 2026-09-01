/**
 * Nested example generation stops here so recursive schemas produce a finite payload.
 */
const MAX_EXAMPLE_DEPTH = 6;

export class SchemaProcessor {
    constructor() {
        this.currentOpenApiSpec = null;
    }

    setOpenApiSpec(spec) {
        this.currentOpenApiSpec = spec;
    }

    resolveSchemaRef(schemaOrRef, openApiSpec = null, seenRefs = new Set()) {
        const spec = openApiSpec || this.currentOpenApiSpec;
        if (!schemaOrRef || !spec) {
            return schemaOrRef;
        }

        if (schemaOrRef.$ref) {
            if (seenRefs.has(schemaOrRef.$ref)) {
                return schemaOrRef;
            }
            seenRefs.add(schemaOrRef.$ref);

            const refPath = schemaOrRef.$ref.split('/').slice(1);

            let resolved = spec;
            for (const part of refPath) {
                if (resolved && resolved[part]) {
                    resolved = resolved[part];
                } else {
                    return schemaOrRef;
                }
            }

            return this.resolveSchemaRefs(resolved, spec, seenRefs);
        }

        return schemaOrRef;
    }

    resolveSchemaRefs(schema, openApiSpec = null, seenRefs = new Set()) {
        if (!schema || typeof schema !== 'object') {
            return schema;
        }

        if (schema.$ref) {
            return this.resolveSchemaRef(schema, openApiSpec, seenRefs);
        }

        const resolved = { ...schema };

        if (resolved.properties) {
            resolved.properties = { ...resolved.properties };
            for (const [key, prop] of Object.entries(resolved.properties)) {
                resolved.properties[key] = this.resolveSchemaRefs(prop, openApiSpec, seenRefs);
            }
        }

        if (resolved.items) {
            resolved.items = this.resolveSchemaRefs(resolved.items, openApiSpec, seenRefs);
        }

        ['allOf', 'oneOf', 'anyOf'].forEach(key => {
            if (resolved[key] && Array.isArray(resolved[key])) {
                resolved[key] = resolved[key].map(item => this.resolveSchemaRefs(item, openApiSpec, seenRefs));
            }
        });

        return resolved;
    }

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

        if (schema.const !== undefined) {
            if (depth === 0) {
                return JSON.stringify(schema.const, null, 2);
            }
            return schema.const;
        }

        const generateValue = (propSchema, propName = '', currentDepth = 0) => {
            if (!propSchema) {
                return 'no-schema';
            }

            if (currentDepth > MAX_EXAMPLE_DEPTH) {
                return null;
            }

            if (propSchema.$ref) {
                const resolved = this.resolveSchemaRef(propSchema);
                if (resolved && resolved !== propSchema) {
                    return generateValue(resolved, propName, currentDepth + 1);
                }
                return 'ref-placeholder';
            }

            if (Array.isArray(propSchema.type)) {
                const primary = propSchema.type.find((t) => t !== 'null') ?? propSchema.type[0];
                propSchema = { ...propSchema, type: primary };
            }

            if (propSchema.properties && !propSchema.type) {
                propSchema = { ...propSchema, type: 'object' };
            }

            if (propSchema.example !== undefined && propSchema.example !== null) {
                return propSchema.example;
            }

            if (propSchema.const !== undefined) {
                return propSchema.const;
            }

            if (propSchema.default !== undefined) {
                return propSchema.default;
            }

            return this._generateValueByType(propSchema, propName, currentDepth, generateValue);
        };

        let example;

        if (Array.isArray(schema.type)) {
            example = generateValue(schema, 'root', depth);
        } else if (schema.type === 'object' && schema.properties) {
            example = generateValue(schema, 'root', depth);
        } else if (schema.properties && !schema.type) {
            example = generateValue({ ...schema, type: 'object' }, 'root', depth);
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
                return JSON.stringify(example, null, 2);
            
        } 
            return example;
        
    }

    _generateValueByType(propSchema, propName, currentDepth, generateValue) {
        switch (propSchema.type) {
            case 'string':
                return this._generateStringValue(propName);
                
            case 'number':
            case 'integer':
                return this._generateNumberValue(propSchema, propName);
                
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
    }

    _generateStringValue(propName) {
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

    _generateNumberValue(propSchema, propName) {
        if (propSchema.minimum !== undefined) {return propSchema.minimum;}
        if (propSchema.maximum !== undefined && propSchema.minimum !== undefined) {
            return Math.floor((propSchema.minimum + propSchema.maximum) / 2);
        }
        if (propSchema.enum) {return propSchema.enum[0];}
        
        const name = propName.toLowerCase();
        if (name.includes('id')) {return 1;}
        if (name.includes('count')) {return 10;}
        if (name.includes('price')) {return 99.99;}
        if (name.includes('age')) {return 25;}
        
        return propSchema.type === 'integer' ? 42 : 42.5;
    }
}