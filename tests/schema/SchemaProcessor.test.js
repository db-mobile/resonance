import { SchemaProcessor } from '../../src/modules/schema/SchemaProcessor.js';

describe('SchemaProcessor', () => {
    let processor;

    beforeEach(() => {
        processor = new SchemaProcessor();
    });

    describe('setOpenApiSpec', () => {
        test('should set OpenAPI spec', () => {
            const spec = { openapi: '3.0.0' };
            processor.setOpenApiSpec(spec);
            expect(processor.currentOpenApiSpec).toBe(spec);
        });
    });

    describe('resolveSchemaRef', () => {
        test('should resolve simple $ref', () => {
            const spec = {
                components: {
                    schemas: {
                        User: {
                            type: 'object',
                            properties: {
                                id: { type: 'integer' },
                                name: { type: 'string' }
                            }
                        }
                    }
                }
            };
            processor.setOpenApiSpec(spec);

            const schemaRef = { $ref: '#/components/schemas/User' };
            const result = processor.resolveSchemaRef(schemaRef);
            
            expect(result).toEqual({
                type: 'object',
                properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' }
                }
            });
        });

        test('should return original schema if no $ref', () => {
            const schema = { type: 'string' };
            const result = processor.resolveSchemaRef(schema);
            expect(result).toBe(schema);
        });

        test('should handle missing spec', () => {
            const schemaRef = { $ref: '#/components/schemas/User' };
            const result = processor.resolveSchemaRef(schemaRef);
            expect(result).toBe(schemaRef);
        });
    });

    describe('generateExampleFromSchema', () => {
        test('should generate example from simple object schema', () => {
            const schema = {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'integer' }
                }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(parsed).toHaveProperty('name');
            expect(parsed).toHaveProperty('age');
            expect(typeof parsed.name).toBe('string');
            expect(typeof parsed.age).toBe('number');
        });

        test('should generate example from array schema', () => {
            const schema = {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' }
                    }
                }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(1);
            expect(parsed[0]).toHaveProperty('id');
            expect(parsed[0]).toHaveProperty('name');
        });

        test('should use schema examples when available', () => {
            const schema = {
                type: 'object',
                example: { customField: 'customValue' }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(parsed).toEqual({ customField: 'customValue' });
        });

        test('should handle nested objects', () => {
            const schema = {
                type: 'object',
                properties: {
                    user: {
                        type: 'object',
                        properties: {
                            profile: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(parsed.user.profile.name).toBeDefined();
            expect(typeof parsed.user.profile.name).toBe('string');
        });

        test('should handle boolean type', () => {
            const schema = {
                type: 'object',
                properties: {
                    isActive: { type: 'boolean' }
                }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(parsed.isActive).toBe(false);
        });

        test('should handle number type', () => {
            const schema = {
                type: 'object',
                properties: {
                    price: { type: 'number' },
                    count: { type: 'integer' }
                }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(typeof parsed.price).toBe('number');
            expect(typeof parsed.count).toBe('number');
        });

        test('should return default example for null schema', () => {
            const result = processor.generateExampleFromSchema(null);
            const parsed = JSON.parse(result);
            
            expect(parsed).toEqual({ 'data': 'example' });
        });

        test('should handle schema with default values', () => {
            const schema = {
                type: 'object',
                properties: {
                    status: { type: 'string', default: 'active' }
                }
            };
            
            const result = processor.generateExampleFromSchema(schema);
            const parsed = JSON.parse(result);
            
            expect(parsed.status).toBe('active');
        });
    });

    describe('_generateStringValue', () => {
        test('should generate contextual string values', () => {
            expect(processor._generateStringValue('name')).toBe('Example Name');
            expect(processor._generateStringValue('title')).toBe('Example Title');
            expect(processor._generateStringValue('email')).toBe('user@example.com');
            expect(processor._generateStringValue('phone')).toBe('+1-555-0123');
            expect(processor._generateStringValue('url')).toBe('https://example.com');
        });

        test('should generate random string for unknown fields', () => {
            const result = processor._generateStringValue('unknownField');
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('_generateNumberValue', () => {
        test('should use minimum value when available', () => {
            const schema = { type: 'integer', minimum: 5 };
            const result = processor._generateNumberValue(schema, 'test');
            expect(result).toBe(5);
        });

        test('should use enum value when available', () => {
            const schema = { type: 'integer', enum: [1, 2, 3] };
            const result = processor._generateNumberValue(schema, 'test');
            expect(result).toBe(1);
        });

        test('should generate contextual number values', () => {
            expect(processor._generateNumberValue({ type: 'integer' }, 'id')).toBe(1);
            expect(processor._generateNumberValue({ type: 'integer' }, 'count')).toBe(10);
            expect(processor._generateNumberValue({ type: 'number' }, 'price')).toBe(99.99);
            expect(processor._generateNumberValue({ type: 'integer' }, 'age')).toBe(25);
        });

        test('should return default values for integer and number types', () => {
            expect(processor._generateNumberValue({ type: 'integer' }, 'unknown')).toBe(42);
            expect(processor._generateNumberValue({ type: 'number' }, 'unknown')).toBe(42.5);
        });
    });

    describe('resolveSchemaRefs', () => {
        test('should resolve nested $refs', () => {
            const spec = {
                components: {
                    schemas: {
                        User: {
                            type: 'object',
                            properties: {
                                id: { type: 'integer' },
                                profile: { $ref: '#/components/schemas/Profile' }
                            }
                        },
                        Profile: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' }
                            }
                        }
                    }
                }
            };
            processor.setOpenApiSpec(spec);

            const schema = { $ref: '#/components/schemas/User' };
            const result = processor.resolveSchemaRefs(schema);
            
            expect(result.type).toBe('object');
            expect(result.properties.profile.type).toBe('object');
            expect(result.properties.profile.properties.name.type).toBe('string');
        });

        test('should handle array items with $refs', () => {
            const spec = {
                components: {
                    schemas: {
                        UserList: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/User' }
                        },
                        User: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' }
                            }
                        }
                    }
                }
            };
            processor.setOpenApiSpec(spec);

            const schema = { $ref: '#/components/schemas/UserList' };
            const result = processor.resolveSchemaRefs(schema);
            
            expect(result.type).toBe('array');
            expect(result.items.type).toBe('object');
            expect(result.items.properties.name.type).toBe('string');
        });

        test('should return original schema if no $ref', () => {
            const schema = { type: 'string' };
            const result = processor.resolveSchemaRefs(schema);
            expect(result).toEqual(schema);
        });
    });

    describe('circular $refs', () => {
        const circularSpec = {
            components: {
                schemas: {
                    A: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            b: { $ref: '#/components/schemas/B' }
                        }
                    },
                    B: {
                        type: 'object',
                        properties: {
                            a: { $ref: '#/components/schemas/A' }
                        }
                    },
                    Node: {
                        type: 'object',
                        properties: {
                            label: { type: 'string' },
                            children: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/Node' }
                            }
                        }
                    }
                }
            }
        };

        beforeEach(() => {
            processor.setOpenApiSpec(circularSpec);
        });

        test('mutually recursive refs terminate with non-cyclic fields resolved', () => {
            const result = processor.resolveSchemaRefs({ $ref: '#/components/schemas/A' });

            expect(result.properties.name.type).toBe('string');
            expect(result.properties.b.type).toBe('object');
            expect(result.properties.b.properties.a.$ref).toBe('#/components/schemas/A');
        });

        test('a self-referential array schema terminates', () => {
            const result = processor.resolveSchemaRefs({ $ref: '#/components/schemas/Node' });

            expect(result.properties.label.type).toBe('string');
            expect(result.properties.children.items.$ref).toBe('#/components/schemas/Node');
        });

        test('example generation produces a finite serializable value for cycles', () => {
            const resolved = processor.resolveSchemaRefs({ $ref: '#/components/schemas/Node' });

            const example = processor.generateExampleFromSchema(resolved);

            expect(() => JSON.parse(example)).not.toThrow();
            expect(example.length).toBeLessThan(10000);
        });

        test('example generation terminates for mutually recursive schemas', () => {
            const resolved = processor.resolveSchemaRefs({ $ref: '#/components/schemas/A' });

            const example = processor.generateExampleFromSchema(resolved);

            expect(typeof example).toBe('string');
            expect(() => JSON.parse(example)).not.toThrow();
        });

        test('does not mutate the input schema when inferring the object type', () => {
            const schema = { properties: { name: { type: 'string' } } };

            processor.generateExampleFromSchema(schema);

            expect(schema.type).toBeUndefined();
        });
    });

    describe('OpenAPI 3.1 schemas', () => {
        test('type arrays resolve to their first non-null entry', () => {
            const schema = {
                type: 'object',
                properties: {
                    name: { type: ['string', 'null'] },
                    count: { type: ['null', 'integer'] }
                }
            };

            const parsed = JSON.parse(processor.generateExampleFromSchema(schema));

            expect(typeof parsed.name).toBe('string');
            expect(typeof parsed.count).toBe('number');
        });

        test('a root-level type array generates a value', () => {
            const schema = { type: ['string', 'null'] };

            const result = processor.generateExampleFromSchema(schema);

            expect(typeof result).toBe('string');
        });

        test('const is used like an example', () => {
            const schema = {
                type: 'object',
                properties: {
                    kind: { const: 'widget' }
                }
            };

            const parsed = JSON.parse(processor.generateExampleFromSchema(schema));

            expect(parsed.kind).toBe('widget');
        });

        test('a root-level const wins over generation', () => {
            const result = processor.generateExampleFromSchema({ const: { fixed: true } });

            expect(JSON.parse(result)).toEqual({ fixed: true });
        });
    });
});
