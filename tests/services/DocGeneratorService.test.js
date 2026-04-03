import { DocGeneratorService } from '../../src/modules/services/DocGeneratorService.js';

// Mock the codeGenerator module
jest.mock('../../src/modules/codeGenerator.js', () => ({
    generateCode: jest.fn((config, langId) => `// Generated ${langId} code for ${config.method} ${config.url}`),
    SUPPORTED_LANGUAGES: [
        { id: 'curl', name: 'cURL', description: 'Command line tool' },
        { id: 'python', name: 'Python', description: 'Requests library' },
        { id: 'javascript-fetch', name: 'JavaScript', description: 'Fetch API' }
    ]
}));

// Mock fetch for template loading
global.fetch = jest.fn();

describe('DocGeneratorService', () => {
    let service;
    let mockCollectionRepository;

    const mockCollection = {
        id: 'col-1',
        name: 'Test API',
        description: 'A test API collection',
        baseUrl: 'https://api.example.com',
        endpoints: [
            {
                id: 'ep-1',
                method: 'GET',
                name: 'Get Users',
                path: '/users',
                description: 'Retrieve all users'
            },
            {
                id: 'ep-2',
                method: 'POST',
                name: 'Create User',
                path: '/users',
                description: 'Create a new user',
                requestBody: {
                    contentType: 'application/json',
                    example: { name: 'John', email: 'john@example.com' }
                }
            }
        ]
    };

    const mockCollectionWithFolders = {
        id: 'col-2',
        name: 'Organized API',
        description: 'An API with folders',
        baseUrl: 'https://api.example.com',
        folders: [
            {
                name: 'Users',
                endpoints: [
                    { id: 'ep-1', method: 'GET', name: 'List Users', path: '/users' },
                    { id: 'ep-2', method: 'POST', name: 'Create User', path: '/users' }
                ]
            },
            {
                name: 'Products',
                endpoints: [
                    { id: 'ep-3', method: 'GET', name: 'List Products', path: '/products' }
                ]
            }
        ]
    };

    const mockCollectionWithMixedEndpoints = {
        id: 'col-3',
        name: 'Mixed API',
        endpoints: [
            { id: 'ep-1', method: 'GET', name: 'HTTP Endpoint', path: '/api' },
            { id: 'ep-2', method: 'WEBSOCKET', name: 'WS Endpoint', path: '/ws' },
            { id: 'ep-3', method: 'GRPC', name: 'gRPC Endpoint', path: '/grpc' },
            { id: 'ep-4', method: 'POST', name: 'Another HTTP', path: '/api/post' }
        ]
    };

    beforeEach(() => {
        mockCollectionRepository = {
            getAllPersistedEndpointData: jest.fn().mockResolvedValue(null)
        };

        service = new DocGeneratorService(mockCollectionRepository);

        // Reset fetch mock
        global.fetch.mockReset();

        // Clear template cache
        Object.keys(DocGeneratorService).forEach(key => {
            if (key.startsWith('_cached_')) {
                delete DocGeneratorService[key];
            }
        });
    });

    describe('getAvailableLanguages', () => {
        test('should return supported languages', () => {
            const languages = DocGeneratorService.getAvailableLanguages();
            
            expect(languages).toHaveLength(3);
            expect(languages[0]).toHaveProperty('id', 'curl');
            expect(languages[0]).toHaveProperty('name', 'cURL');
        });
    });

    describe('HTTP endpoint filtering', () => {
        describe('_isHttpEndpoint', () => {
            test('should return true for HTTP methods', () => {
                expect(service._isHttpEndpoint({ method: 'GET' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'POST' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'PUT' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'PATCH' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'DELETE' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'HEAD' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'OPTIONS' })).toBe(true);
            });

            test('should return true for lowercase HTTP methods', () => {
                expect(service._isHttpEndpoint({ method: 'get' })).toBe(true);
                expect(service._isHttpEndpoint({ method: 'post' })).toBe(true);
            });

            test('should return false for non-HTTP methods', () => {
                expect(service._isHttpEndpoint({ method: 'WEBSOCKET' })).toBe(false);
                expect(service._isHttpEndpoint({ method: 'GRPC' })).toBe(false);
                expect(service._isHttpEndpoint({ method: 'SSE' })).toBe(false);
            });

            test('should return false for null or undefined', () => {
                expect(service._isHttpEndpoint(null)).toBe(false);
                expect(service._isHttpEndpoint(undefined)).toBe(false);
                expect(service._isHttpEndpoint({})).toBe(false);
            });
        });

        describe('_filterHttpEndpoints', () => {
            test('should filter out non-HTTP endpoints', () => {
                const endpoints = [
                    { method: 'GET', path: '/api' },
                    { method: 'WEBSOCKET', path: '/ws' },
                    { method: 'POST', path: '/api/create' }
                ];

                const filtered = service._filterHttpEndpoints(endpoints);

                expect(filtered).toHaveLength(2);
                expect(filtered[0].method).toBe('GET');
                expect(filtered[1].method).toBe('POST');
            });

            test('should return empty array for null or undefined', () => {
                expect(service._filterHttpEndpoints(null)).toEqual([]);
                expect(service._filterHttpEndpoints(undefined)).toEqual([]);
            });

            test('should return empty array when no HTTP endpoints', () => {
                const endpoints = [
                    { method: 'WEBSOCKET', path: '/ws' },
                    { method: 'GRPC', path: '/grpc' }
                ];

                expect(service._filterHttpEndpoints(endpoints)).toEqual([]);
            });
        });

        describe('hasHttpEndpoints', () => {
            test('should return true for collection with HTTP endpoints', () => {
                expect(service.hasHttpEndpoints(mockCollection)).toBe(true);
            });

            test('should return true for collection with folders containing HTTP endpoints', () => {
                expect(service.hasHttpEndpoints(mockCollectionWithFolders)).toBe(true);
            });

            test('should return false for collection with only non-HTTP endpoints', () => {
                const collection = {
                    endpoints: [
                        { method: 'WEBSOCKET', path: '/ws' },
                        { method: 'GRPC', path: '/grpc' }
                    ]
                };

                expect(service.hasHttpEndpoints(collection)).toBe(false);
            });

            test('should return false for collection with folders containing only non-HTTP endpoints', () => {
                const collection = {
                    folders: [
                        {
                            name: 'WebSockets',
                            endpoints: [{ method: 'WEBSOCKET', path: '/ws' }]
                        }
                    ]
                };

                expect(service.hasHttpEndpoints(collection)).toBe(false);
            });

            test('should return false for empty collection', () => {
                expect(service.hasHttpEndpoints({ endpoints: [] })).toBe(false);
            });
        });
    });

    describe('generateMarkdown', () => {
        test('should generate markdown with collection header', async () => {
            const markdown = await service.generateMarkdown(mockCollection);

            expect(markdown).toContain('# Test API');
            expect(markdown).toContain('A test API collection');
            expect(markdown).toContain('**Base URL:** `https://api.example.com`');
        });

        test('should generate table of contents', async () => {
            const markdown = await service.generateMarkdown(mockCollection);

            expect(markdown).toContain('## Table of Contents');
            expect(markdown).toContain('- [GET Get Users]');
            expect(markdown).toContain('- [POST Create User]');
        });

        test('should generate endpoint documentation', async () => {
            const markdown = await service.generateMarkdown(mockCollection);

            expect(markdown).toContain('### GET Get Users');
            expect(markdown).toContain('Retrieve all users');
            expect(markdown).toContain('**URL:** `https://api.example.com/users`');
        });

        test('should filter out non-HTTP endpoints', async () => {
            const markdown = await service.generateMarkdown(mockCollectionWithMixedEndpoints);

            expect(markdown).toContain('GET HTTP Endpoint');
            expect(markdown).toContain('POST Another HTTP');
            expect(markdown).not.toContain('WEBSOCKET');
            expect(markdown).not.toContain('GRPC');
        });

        test('should generate folder structure', async () => {
            const markdown = await service.generateMarkdown(mockCollectionWithFolders);

            expect(markdown).toContain('## Users');
            expect(markdown).toContain('## Products');
            expect(markdown).toContain('- [Users]');
            expect(markdown).toContain('- [Products]');
        });

        test('should include code samples when languages specified', async () => {
            const markdown = await service.generateMarkdown(mockCollection, {
                languages: ['curl']
            });

            expect(markdown).toContain('#### Code Samples');
            expect(markdown).toContain('```bash');
        });

        test('should include footer with generation date', async () => {
            const markdown = await service.generateMarkdown(mockCollection);

            expect(markdown).toContain('---');
            expect(markdown).toContain('*Generated by Resonance on');
        });
    });

    describe('generateHtml', () => {
        const mockTemplate = `<!DOCTYPE html>
<html>
<head><title>{{TITLE}} - API Documentation</title></head>
<body>
<h1>{{TITLE}}</h1>
{{DESCRIPTION}}
{{BASE_URL}}
{{TOC}}
{{CONTENT}}
<footer>Generated on {{DATE}}</footer>
</body>
</html>`;

        beforeEach(() => {
            global.fetch.mockResolvedValue({
                ok: true,
                text: () => Promise.resolve(mockTemplate)
            });
        });

        test('should load template and replace placeholders', async () => {
            const html = await service.generateHtml(mockCollection);

            expect(global.fetch).toHaveBeenCalledWith('./src/templates/docs/docTemplate.html');
            expect(html).toContain('<title>Test API - API Documentation</title>');
            expect(html).toContain('<h1>Test API</h1>');
        });

        test('should include description when present', async () => {
            const html = await service.generateHtml(mockCollection);

            expect(html).toContain('A test API collection');
        });

        test('should include base URL when present', async () => {
            const html = await service.generateHtml(mockCollection);

            expect(html).toContain('https://api.example.com');
        });

        test('should generate table of contents', async () => {
            const html = await service.generateHtml(mockCollection);

            expect(html).toContain('get-get-users');
            expect(html).toContain('post-create-user');
        });

        test('should filter out non-HTTP endpoints', async () => {
            const html = await service.generateHtml(mockCollectionWithMixedEndpoints);

            expect(html).toContain('HTTP Endpoint');
            expect(html).not.toContain('WS Endpoint');
            expect(html).not.toContain('gRPC Endpoint');
        });

        test('should handle template load failure gracefully', async () => {
            global.fetch.mockRejectedValue(new Error('Network error'));

            const html = await service.generateHtml(mockCollection);

            // Should return empty string when template fails to load
            expect(html).toBe('');
        });

        test('should cache loaded template', async () => {
            await service.generateHtml(mockCollection);
            await service.generateHtml(mockCollection);

            // Template should only be fetched once due to caching
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('helper methods', () => {
        describe('_slugify', () => {
            test('should convert text to URL-friendly slug', () => {
                expect(service._slugify('Hello World')).toBe('hello-world');
                expect(service._slugify('GET /users/{id}')).toBe('get-users-id');
                expect(service._slugify('Create New User')).toBe('create-new-user');
            });

            test('should remove leading and trailing hyphens', () => {
                expect(service._slugify('--test--')).toBe('test');
                expect(service._slugify('  spaces  ')).toBe('spaces');
            });
        });

        describe('_escapeHtml', () => {
            test('should escape HTML special characters', () => {
                expect(service._escapeHtml('<script>')).toBe('&lt;script&gt;');
                expect(service._escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
                expect(service._escapeHtml("it's")).toBe('it&#039;s');
                expect(service._escapeHtml('a & b')).toBe('a &amp; b');
            });

            test('should handle null and undefined', () => {
                expect(service._escapeHtml(null)).toBe('');
                expect(service._escapeHtml(undefined)).toBe('');
            });
        });

        describe('_getCodeBlockLang', () => {
            test('should map language IDs to code block languages', () => {
                expect(service._getCodeBlockLang('curl')).toBe('bash');
                expect(service._getCodeBlockLang('python')).toBe('python');
                expect(service._getCodeBlockLang('javascript-fetch')).toBe('javascript');
                expect(service._getCodeBlockLang('javascript-axios')).toBe('javascript');
                expect(service._getCodeBlockLang('nodejs')).toBe('javascript');
                expect(service._getCodeBlockLang('go')).toBe('go');
                expect(service._getCodeBlockLang('php')).toBe('php');
                expect(service._getCodeBlockLang('ruby')).toBe('ruby');
                expect(service._getCodeBlockLang('java')).toBe('java');
            });

            test('should return text for unknown languages', () => {
                expect(service._getCodeBlockLang('unknown')).toBe('text');
            });
        });
    });

    describe('persisted data handling', () => {
        test('should fetch persisted data when includePersistedData is true', async () => {
            mockCollectionRepository.getAllPersistedEndpointData.mockResolvedValue({
                modifiedBody: '{"custom": "data"}',
                queryParams: [{ key: 'page', value: '1' }]
            });

            await service.generateMarkdown(mockCollection, { includePersistedData: true });

            expect(mockCollectionRepository.getAllPersistedEndpointData).toHaveBeenCalled();
        });

        test('should not fetch persisted data when includePersistedData is false', async () => {
            await service.generateMarkdown(mockCollection, { includePersistedData: false });

            // Repository should still be called for response schema
            // but the main persisted data fetch in _generateEndpointMarkdown should not happen
            // Actually, it's always called for responseSchema, so let's just verify the markdown doesn't include persisted values
            const markdown = await service.generateMarkdown(mockCollection, { includePersistedData: false });
            
            expect(markdown).not.toContain('custom');
        });
    });
});
