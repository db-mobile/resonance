import OpenApiParser from '../../src/main/openApiParser.js';

describe('OpenApiParser', () => {
    let parser;
    let mockSchemaProcessor;
    let mockStore;

    beforeEach(() => {
        mockSchemaProcessor = {
            setOpenApiSpec: jest.fn(),
            resolveSchemaRef: jest.fn(param => param),
            parseRequestBody: jest.fn(() => null)
        };

        mockStore = {
            get: jest.fn().mockReturnValue([]),
            set: jest.fn()
        };

        parser = new OpenApiParser(mockSchemaProcessor, mockStore);
    });

    describe('validateOpenApiSpec', () => {
        describe('valid specs', () => {
            it('should accept valid OpenAPI 3.0.0 spec', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    paths: {}
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(true);
            });

            it('should accept valid OpenAPI 3.0.3 spec', () => {
                const spec = {
                    openapi: '3.0.3',
                    info: { title: 'Test API', version: '1.0.0' },
                    paths: {}
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(true);
            });

            it('should accept valid OpenAPI 3.1.0 spec', () => {
                const spec = {
                    openapi: '3.1.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    paths: {}
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(true);
            });

            it('should accept valid Swagger 2.0 spec', () => {
                const spec = {
                    swagger: '2.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    paths: {}
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(true);
            });

            it('should accept spec without paths', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' }
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(true);
            });

            it('should accept spec with valid servers array', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    servers: [
                        { url: 'https://api.example.com' },
                        { url: 'https://staging.example.com' }
                    ]
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(true);
            });
        });

        describe('invalid specs', () => {
            it('should reject null spec', () => {
                const result = parser.validateOpenApiSpec(null);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject undefined spec', () => {
                const result = parser.validateOpenApiSpec(undefined);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject non-object spec', () => {
                const result = parser.validateOpenApiSpec('string');
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('must be an object');
            });

            it('should reject spec without version field', () => {
                const spec = {
                    info: { title: 'Test API', version: '1.0.0' }
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('openapi');
            });

            it('should reject unsupported OpenAPI version', () => {
                const spec = {
                    openapi: '4.0.0',
                    info: { title: 'Test API', version: '1.0.0' }
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('Unsupported OpenAPI version');
            });

            it('should reject unsupported Swagger version', () => {
                const spec = {
                    swagger: '1.0',
                    info: { title: 'Test API', version: '1.0.0' }
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('Unsupported Swagger version');
            });

            it('should reject spec without info object', () => {
                const spec = {
                    openapi: '3.0.0'
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('info');
            });

            it('should reject spec with non-object info', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: 'invalid'
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('info');
            });

            it('should reject spec with non-object paths', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    paths: 'invalid'
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('paths');
            });

            it('should reject spec with non-array servers', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    servers: 'invalid'
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('servers');
            });

            it('should reject spec with invalid server object', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    servers: ['invalid']
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('server at index 0');
            });

            it('should reject spec with server missing url', () => {
                const spec = {
                    openapi: '3.0.0',
                    info: { title: 'Test API', version: '1.0.0' },
                    servers: [{ description: 'Test server' }]
                };
                const result = parser.validateOpenApiSpec(spec);
                expect(result.isValid).toBe(false);
                expect(result.error).toContain('url');
            });
        });
    });

    describe('parseOpenApiToCollection', () => {
        it('should throw error for invalid spec', () => {
            expect(() => {
                parser.parseOpenApiToCollection(null, 'test.json');
            }).toThrow('Invalid OpenAPI specification');
        });

        it('should throw error for spec without version', () => {
            const spec = { info: { title: 'Test' } };
            expect(() => {
                parser.parseOpenApiToCollection(spec, 'test.json');
            }).toThrow('Invalid OpenAPI specification');
        });

        it('should parse valid spec successfully', () => {
            const spec = {
                openapi: '3.0.0',
                info: { title: 'Test API', version: '1.0.0' },
                paths: {}
            };
            const collection = parser.parseOpenApiToCollection(spec, 'test.json');
            expect(collection.name).toBe('Test API');
            expect(collection.version).toBe('1.0.0');
        });

        it('should use filename as fallback for name', () => {
            const spec = {
                openapi: '3.0.0',
                info: { version: '1.0.0' },
                paths: {}
            };
            const collection = parser.parseOpenApiToCollection(spec, 'test-api.json');
            expect(collection.name).toBe('test-api.json');
        });

        it('should extract base URL from servers', () => {
            const spec = {
                openapi: '3.0.0',
                info: { title: 'Test API', version: '1.0.0' },
                servers: [{ url: 'https://api.example.com/v1' }],
                paths: {}
            };
            const collection = parser.parseOpenApiToCollection(spec, 'test.json');
            expect(collection.baseUrl).toBe('https://api.example.com/v1');
        });

        it('should handle spec without servers', () => {
            const spec = {
                openapi: '3.0.0',
                info: { title: 'Test API', version: '1.0.0' },
                paths: {}
            };
            const collection = parser.parseOpenApiToCollection(spec, 'test.json');
            expect(collection.baseUrl).toBe('');
        });

        it('should call schemaProcessor.setOpenApiSpec', () => {
            const spec = {
                openapi: '3.0.0',
                info: { title: 'Test API', version: '1.0.0' },
                paths: {}
            };
            parser.parseOpenApiToCollection(spec, 'test.json');
            expect(mockSchemaProcessor.setOpenApiSpec).toHaveBeenCalledWith(spec);
        });
    });
});
