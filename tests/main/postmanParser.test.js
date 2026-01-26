import PostmanParser from '../../src/main/postmanParser.js';

describe('PostmanParser', () => {
    let parser;
    let mockStore;

    beforeEach(() => {
        mockStore = {
            get: jest.fn().mockReturnValue([]),
            set: jest.fn()
        };

        parser = new PostmanParser(mockStore);
    });

    describe('validatePostmanCollection', () => {
        describe('valid collections', () => {
            it('should accept valid v2.0.0 collection', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'
                    },
                    item: []
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(true);
            });

            it('should accept valid v2.1.0 collection', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    },
                    item: []
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(true);
            });

            it('should accept collection with auth', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    },
                    auth: { type: 'bearer' },
                    item: []
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(true);
            });

            it('should accept collection with variables', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    },
                    variable: [
                        { key: 'baseUrl', value: 'https://api.example.com' }
                    ],
                    item: []
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(true);
            });

            it('should accept collection without item array', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    }
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(true);
            });
        });

        describe('invalid collections', () => {
            it('should reject null collection', () => {
                const result = parser.validatePostmanCollection(null);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject undefined collection', () => {
                const result = parser.validatePostmanCollection(undefined);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject non-object collection', () => {
                const result = parser.validatePostmanCollection('string');
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject collection without info', () => {
                const collection = { item: [] };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('info');
            });

            it('should reject collection with non-object info', () => {
                const collection = { info: 'invalid' };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('info');
            });

            it('should reject collection without schema', () => {
                const collection = {
                    info: { name: 'Test Collection' }
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('schema');
            });

            it('should reject collection with unsupported schema', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json'
                    }
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('Unsupported');
            });

            it('should reject collection with non-array item', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    },
                    item: 'invalid'
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('item');
            });

            it('should reject collection with non-object auth', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    },
                    auth: 'invalid'
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('auth');
            });

            it('should reject collection with non-array variable', () => {
                const collection = {
                    info: {
                        name: 'Test Collection',
                        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                    },
                    variable: 'invalid'
                };
                const result = parser.validatePostmanCollection(collection);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('variable');
            });
        });
    });

    describe('validatePostmanEnvironment', () => {
        describe('valid environments', () => {
            it('should accept valid environment', () => {
                const env = {
                    name: 'Test Environment',
                    values: [
                        { key: 'baseUrl', value: 'https://api.example.com' }
                    ]
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(true);
            });

            it('should accept environment with empty values', () => {
                const env = {
                    name: 'Test Environment',
                    values: []
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(true);
            });

            it('should accept environment with multiple values', () => {
                const env = {
                    name: 'Test Environment',
                    values: [
                        { key: 'baseUrl', value: 'https://api.example.com' },
                        { key: 'apiKey', value: 'secret123' },
                        { key: 'timeout', value: '5000' }
                    ]
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(true);
            });
        });

        describe('invalid environments', () => {
            it('should reject null environment', () => {
                const result = parser.validatePostmanEnvironment(null);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject undefined environment', () => {
                const result = parser.validatePostmanEnvironment(undefined);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject environment without name', () => {
                const env = {
                    values: []
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('name');
            });

            it('should reject environment with non-string name', () => {
                const env = {
                    name: 123,
                    values: []
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('name');
            });

            it('should reject environment without values', () => {
                const env = {
                    name: 'Test'
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('values');
            });

            it('should reject environment with non-array values', () => {
                const env = {
                    name: 'Test',
                    values: 'invalid'
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('values');
            });

            it('should reject environment with invalid value entry', () => {
                const env = {
                    name: 'Test',
                    values: ['invalid']
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('index 0');
            });

            it('should reject environment with value missing key', () => {
                const env = {
                    name: 'Test',
                    values: [{ value: 'test' }]
                };
                const result = parser.validatePostmanEnvironment(env);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('key');
            });
        });
    });

    describe('parsePostmanToCollection', () => {
        it('should throw error for invalid collection', () => {
            expect(() => {
                parser.parsePostmanToCollection(null, 'test.json');
            }).toThrow('Invalid Postman collection');
        });

        it('should throw error for collection without schema', () => {
            const collection = {
                info: { name: 'Test' }
            };
            expect(() => {
                parser.parsePostmanToCollection(collection, 'test.json');
            }).toThrow('Invalid Postman collection');
        });

        it('should parse valid collection successfully', () => {
            const collection = {
                info: {
                    name: 'Test Collection',
                    version: '1.0.0',
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                },
                item: []
            };
            const result = parser.parsePostmanToCollection(collection, 'test.json');
            expect(result.name).toBe('Test Collection');
            expect(result.version).toBe('1.0.0');
        });

        it('should use filename as fallback for name', () => {
            const collection = {
                info: {
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                },
                item: []
            };
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            const result = parser.parsePostmanToCollection(collection, 'test-api.json');
            expect(result.name).toBe('test-api.json');
            consoleSpy.mockRestore();
        });

        it('should extract auth from collection', () => {
            const collection = {
                info: {
                    name: 'Test Collection',
                    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
                },
                auth: {
                    type: 'bearer',
                    bearer: [{ key: 'token', value: 'test-token' }]
                },
                item: []
            };
            const result = parser.parsePostmanToCollection(collection, 'test.json');
            expect(result.defaultAuth).toBeDefined();
            expect(result.defaultAuth.type).toBe('bearer');
        });
    });

    describe('extractVariables', () => {
        it('should extract variables from collection', () => {
            const collection = {
                variable: [
                    { key: 'baseUrl', value: 'https://api.example.com' },
                    { key: 'apiKey', value: 'secret123' }
                ]
            };
            const result = parser.extractVariables(collection);
            expect(result.baseUrl).toBe('https://api.example.com');
            expect(result.apiKey).toBe('secret123');
        });

        it('should return empty object for collection without variables', () => {
            const collection = {};
            const result = parser.extractVariables(collection);
            expect(result).toEqual({});
        });

        it('should handle empty variable array', () => {
            const collection = { variable: [] };
            const result = parser.extractVariables(collection);
            expect(result).toEqual({});
        });

        it('should skip variables without key', () => {
            const collection = {
                variable: [
                    { value: 'no-key' },
                    { key: 'valid', value: 'test' }
                ]
            };
            const result = parser.extractVariables(collection);
            expect(result).toEqual({ valid: 'test' });
        });
    });
});
