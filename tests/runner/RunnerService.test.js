/* global window */
import { RunnerService } from '../../src/modules/services/RunnerService.js';
import { ScriptService } from '../../src/modules/services/ScriptService.js';
import { app } from '../../src/modules/appContext.js';

describe('RunnerService', () => {
    let service;
    let mockRepository;
    let mockBackendAPI;
    let mockStatusDisplay;
    let mockEnvironmentService;

    beforeEach(() => {
        mockRepository = {
            getAll: jest.fn(),
            getById: jest.fn(),
            add: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            updateLastRun: jest.fn()
        };

        mockBackendAPI = {
            sendApiRequest: jest.fn(),
            scripts: {
                executeTest: jest.fn(),
                executePreRequest: jest.fn()
            },
            settings: {
                get: jest.fn().mockResolvedValue({})
            },
            store: {
                get: jest.fn(),
                set: jest.fn()
            }
        };

        mockStatusDisplay = {
            update: jest.fn()
        };

        service = new RunnerService(mockRepository, mockBackendAPI, mockStatusDisplay);

        mockEnvironmentService = {
            getActiveEnvironment: jest.fn().mockResolvedValue({ id: 'env1', name: 'Dev', secretKeys: [] }),
            getActiveEnvironmentVariables: jest.fn().mockResolvedValue({}),
            setVariable: jest.fn().mockResolvedValue(undefined),
            deleteVariable: jest.fn().mockResolvedValue(undefined)
        };
        window.backendAPI = mockBackendAPI;
        app.scriptController = {
            service: new ScriptService(null, mockEnvironmentService, null),
            getScriptsForEndpoint: jest.fn().mockResolvedValue({ preRequestScript: '', testScript: '' })
        };
    });

    afterEach(() => {
        delete app.scriptController;
        delete app.cookieController;
        delete app.historyController;
        delete window.backendAPI;
    });

    describe('getAllRunners', () => {
        test('should return all runners from repository', async () => {
            const runners = [
                { id: 'runner_1', name: 'Runner 1' },
                { id: 'runner_2', name: 'Runner 2' }
            ];
            mockRepository.getAll.mockResolvedValue(runners);

            const result = await service.getAllRunners();

            expect(result).toEqual(runners);
            expect(mockRepository.getAll).toHaveBeenCalled();
        });
    });

    describe('getRunner', () => {
        test('should return runner by ID', async () => {
            const runner = { id: 'runner_1', name: 'Test Runner' };
            mockRepository.getById.mockResolvedValue(runner);

            const result = await service.getRunner('runner_1');

            expect(result).toEqual(runner);
            expect(mockRepository.getById).toHaveBeenCalledWith('runner_1');
        });

        test('should return undefined for non-existent runner', async () => {
            mockRepository.getById.mockResolvedValue(undefined);

            const result = await service.getRunner('non_existent');

            expect(result).toBeUndefined();
        });
    });

    describe('createRunner', () => {
        test('should create runner and update status', async () => {
            const runnerData = { name: 'New Runner', requests: [] };
            const createdRunner = { id: 'runner_1', ...runnerData };
            mockRepository.add.mockResolvedValue(createdRunner);

            const result = await service.createRunner(runnerData);

            expect(result).toEqual(createdRunner);
            expect(mockRepository.add).toHaveBeenCalledWith(runnerData);
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Runner "New Runner" created', null);
        });
    });

    describe('updateRunner', () => {
        test('should update runner and update status', async () => {
            const updates = { name: 'Updated Runner' };
            const updatedRunner = { id: 'runner_1', name: 'Updated Runner' };
            mockRepository.update.mockResolvedValue(updatedRunner);

            const result = await service.updateRunner('runner_1', updates);

            expect(result).toEqual(updatedRunner);
            expect(mockRepository.update).toHaveBeenCalledWith('runner_1', updates);
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Runner "Updated Runner" saved', null);
        });

        test('should return null for non-existent runner', async () => {
            mockRepository.update.mockResolvedValue(null);

            const result = await service.updateRunner('non_existent', { name: 'Test' });

            expect(result).toBeNull();
            expect(mockStatusDisplay.update).not.toHaveBeenCalled();
        });
    });

    describe('deleteRunner', () => {
        test('should delete runner and update status', async () => {
            mockRepository.delete.mockResolvedValue(true);

            const result = await service.deleteRunner('runner_1');

            expect(result).toBe(true);
            expect(mockRepository.delete).toHaveBeenCalledWith('runner_1');
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Runner deleted', null);
        });

        test('should return false for non-existent runner', async () => {
            mockRepository.delete.mockResolvedValue(false);

            const result = await service.deleteRunner('non_existent');

            expect(result).toBe(false);
            expect(mockStatusDisplay.update).not.toHaveBeenCalled();
        });
    });

    describe('executeRunner', () => {
        test('should throw error if runner is already executing', async () => {
            service.isRunning = true;

            await expect(service.executeRunner('runner_1')).rejects.toThrow('A runner is already executing');
        });

        test('should throw error if runner not found', async () => {
            mockRepository.getById.mockResolvedValue(undefined);

            await expect(service.executeRunner('non_existent')).rejects.toThrow('Runner not found');
        });

        test('should throw error if runner has no requests', async () => {
            mockRepository.getById.mockResolvedValue({
                id: 'runner_1',
                name: 'Empty Runner',
                requests: []
            });

            await expect(service.executeRunner('runner_1')).rejects.toThrow('Runner has no requests to execute');
        });
    });

    describe('executeRunnerData', () => {
        test('should throw error if runner is already executing', async () => {
            service.isRunning = true;

            await expect(service.executeRunnerData({ requests: [] })).rejects.toThrow('A runner is already executing');
        });

        test('should throw error if runner has no requests', async () => {
            await expect(service.executeRunnerData({ requests: [] })).rejects.toThrow('Runner has no requests to execute');
        });
    });

    describe('stopExecution', () => {
        test('should set shouldStop flag when running', () => {
            service.isRunning = true;

            service.stopExecution();

            expect(service.shouldStop).toBe(true);
            expect(mockStatusDisplay.update).toHaveBeenCalledWith('Stopping runner...', null);
        });

        test('should do nothing when not running', () => {
            service.isRunning = false;

            service.stopExecution();

            expect(service.shouldStop).toBe(false);
            expect(mockStatusDisplay.update).not.toHaveBeenCalled();
        });
    });

    describe('isExecuting', () => {
        test('should return true when running', () => {
            service.isRunning = true;

            expect(service.isExecuting()).toBe(true);
        });

        test('should return false when not running', () => {
            service.isRunning = false;

            expect(service.isExecuting()).toBe(false);
        });
    });

    describe('_markRemainingAsSkipped', () => {
        test('should mark remaining requests as skipped', () => {
            const requests = [
                { name: 'Request 1' },
                { name: 'Request 2' },
                { name: 'Request 3' }
            ];
            const results = { requests: [], skipped: 0, totalRequests: 3 };

            service._markRemainingAsSkipped(requests, results, 1, 'Test reason');

            expect(results.requests).toHaveLength(2);
            expect(results.requests[0].status).toBe('skipped');
            expect(results.requests[0].error).toBe('Test reason');
            expect(results.requests[0].index).toBe(1);
            expect(results.skipped).toBe(2);
        });

        test('continues through later iterations of the queue', () => {
            const requests = [{ name: 'A' }, { name: 'B' }];
            const results = { requests: [], skipped: 0, totalRequests: 6 };

            service._markRemainingAsSkipped(requests, results, 3, 'Stopped');

            expect(results.requests.map(r => `${r.iteration}:${r.name}`)).toEqual(['2:B', '3:A', '3:B']);
        });
    });

    describe('_findEndpoint', () => {
        test('should find endpoint in top-level endpoints', () => {
            const collection = {
                endpoints: [
                    { id: 'endpoint_1', name: 'Endpoint 1' },
                    { id: 'endpoint_2', name: 'Endpoint 2' }
                ]
            };

            const result = service._findEndpoint(collection, 'endpoint_2');

            expect(result).toEqual({ id: 'endpoint_2', name: 'Endpoint 2' });
        });

        test('should find endpoint in folders', () => {
            const collection = {
                endpoints: [],
                folders: [
                    {
                        name: 'Folder 1',
                        endpoints: [
                            { id: 'endpoint_1', name: 'Endpoint 1' }
                        ]
                    }
                ]
            };

            const result = service._findEndpoint(collection, 'endpoint_1');

            expect(result).toEqual({ id: 'endpoint_1', name: 'Endpoint 1' });
        });

        test('should return null for non-existent endpoint', () => {
            const collection = {
                endpoints: [{ id: 'endpoint_1' }],
                folders: []
            };

            const result = service._findEndpoint(collection, 'non_existent');

            expect(result).toBeNull();
        });
    });

    describe('_delay', () => {
        test('should delay for specified milliseconds', async () => {
            const start = Date.now();
            await service._delay(50);
            const elapsed = Date.now() - start;

            expect(elapsed).toBeGreaterThanOrEqual(45);
        });
    });

    describe('listeners', () => {
        test('should add listener', () => {
            const listener = jest.fn();

            service.addListener(listener);

            expect(service.listeners).toContain(listener);
        });

        test('should remove listener', () => {
            const listener = jest.fn();
            service.addListener(listener);

            service.removeListener(listener);

            expect(service.listeners).not.toContain(listener);
        });

        test('should notify all listeners', () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            service.addListener(listener1);
            service.addListener(listener2);

            service._notifyListeners('test-event', { data: 'test' });

            expect(listener1).toHaveBeenCalledWith('test-event', { data: 'test' });
            expect(listener2).toHaveBeenCalledWith('test-event', { data: 'test' });
        });

        test('should handle listener errors gracefully', () => {
            const errorListener = jest.fn().mockImplementation(() => {
                throw new Error('Listener error');
            });
            const goodListener = jest.fn();
            service.addListener(errorListener);
            service.addListener(goodListener);

            service._notifyListeners('test-event', {});

            expect(goodListener).toHaveBeenCalled();
        });
    });

    describe('getEndpointRequestConfig', () => {
        test('should aggregate persisted config from the collection repository', async () => {
            service.collectionRepository.getPersistedPathParams = jest
                .fn()
                .mockResolvedValue([{ key: 'id', value: '1' }]);
            service.collectionRepository.getPersistedQueryParams = jest
                .fn()
                .mockResolvedValue([{ key: 'q', value: 'a' }]);
            service.collectionRepository.getPersistedHeaders = jest
                .fn()
                .mockResolvedValue([{ key: 'X-H', value: 'h' }]);
            service.collectionRepository.getModifiedRequestBody = jest
                .fn()
                .mockResolvedValue('{"k":1}');

            const config = await service.getEndpointRequestConfig('c1', 'e1');

            expect(config).toEqual({
                pathParams: [{ key: 'id', value: '1' }],
                queryParams: [{ key: 'q', value: 'a' }],
                headers: [{ key: 'X-H', value: 'h' }],
                body: '{"k":1}'
            });
        });

        test('should default missing config to empty values', async () => {
            service.collectionRepository.getPersistedPathParams = jest.fn().mockResolvedValue(null);
            service.collectionRepository.getPersistedQueryParams = jest.fn().mockResolvedValue(null);
            service.collectionRepository.getPersistedHeaders = jest.fn().mockResolvedValue(null);
            service.collectionRepository.getModifiedRequestBody = jest.fn().mockResolvedValue(null);

            const config = await service.getEndpointRequestConfig('c1', 'e1');

            expect(config).toEqual({ pathParams: [], queryParams: [], headers: [], body: '' });
        });
    });

    describe('_buildRequestConfig with per-request overrides', () => {
        let endpoint;
        let collection;

        beforeEach(() => {
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                headers: [{ key: 'X-Persisted', value: 'persisted' }],
                modifiedBody: '{"from":"collection"}',
                formBodyData: null,
                queryParams: [{ key: 'persistedQ', value: 'pq' }],
                pathParams: [{ key: 'userId', value: 'persisted-id' }]
            });
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue(null);

            collection = { id: 'c1', baseUrl: '', defaultHeaders: {} };
            endpoint = { id: 'e1', method: 'POST', path: '{{baseUrl}}/users/{{userId}}' };
        });

        test('should prefer overrides over persisted config', async () => {
            const overrides = {
                pathParams: [{ key: 'userId', value: 'override-id' }],
                queryParams: [{ key: 'q', value: 'overridden' }],
                headers: [{ key: 'X-Override', value: 'yes' }],
                body: '{"from":"override"}'
            };

            const { requestConfig: config } = await service._buildRequestConfig(
                collection,
                endpoint,
                { baseUrl: 'https://api.test' },
                overrides
            );

            expect(config.url).toContain('/users/override-id');
            expect(config.url).toContain('q=overridden');
            expect(config.url).not.toContain('persistedQ');
            expect(config.headers['X-Override']).toBe('yes');
            expect(config.headers['X-Persisted']).toBeUndefined();
            expect(config.body).toEqual({ from: 'override' });
        });

        test('honors explicitly cleared overrides instead of resurrecting persisted config', async () => {
            const { requestConfig: config } = await service._buildRequestConfig(
                collection,
                endpoint,
                { baseUrl: 'https://api.test' },
                { pathParams: [], queryParams: [], headers: [], body: '' }
            );

            expect(config.url).not.toContain('persistedQ');
            expect(config.headers['X-Persisted']).toBeUndefined();
            expect(config.body).toBeUndefined();
        });

        test('empty path params still fall back so URL templates keep their values', async () => {
            const { requestConfig: config } = await service._buildRequestConfig(
                collection,
                endpoint,
                { baseUrl: 'https://api.test' },
                { pathParams: [], queryParams: [], headers: [], body: '' }
            );

            expect(config.url).toContain('/users/persisted-id');
        });

        test('should behave as before when no overrides are provided', async () => {
            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {
                baseUrl: 'https://api.test'
            });

            expect(config.url).toContain('/users/persisted-id');
            expect(config.headers['X-Persisted']).toBe('persisted');
            expect(config.body).toEqual({ from: 'collection' });
        });
    });

    describe('_buildRequestConfig with form and binary bodies', () => {
        let endpoint;
        let collection;

        const stubPersisted = (formBodyData) => {
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                headers: [],
                modifiedBody: null,
                formBodyData,
                queryParams: [],
                pathParams: []
            });
        };

        beforeEach(() => {
            stubPersisted(null);
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue(null);

            collection = { id: 'c1', baseUrl: '', defaultHeaders: {} };
            endpoint = { id: 'e1', method: 'POST', path: 'https://api.test/upload' };
        });

        test('should assemble form-data rows, filter disabled rows, and substitute variables', async () => {
            stubPersisted({
                mode: 'formdata',
                fields: [
                    { key: 'title', value: '{{val}}', type: 'text', enabled: true },
                    { key: 'skipped', value: 'x', type: 'text', enabled: false },
                    { key: 'avatar', type: 'file', filePath: '{{dir}}/pic.png', contentType: 'image/png' }
                ]
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {
                val: 'hello',
                dir: '/tmp'
            });

            expect(config.bodyType).toBe('formdata');
            expect(config.body).toEqual([
                { key: 'title', value: 'hello', type: 'text' },
                { key: 'avatar', value: '', type: 'file', filePath: '/tmp/pic.png', contentType: 'image/png' }
            ]);
        });

        test('should convert legacy flat-object fields to rows', async () => {
            stubPersisted({
                mode: 'urlencoded',
                fields: { a: '1', b: '2' }
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.bodyType).toBe('urlencoded');
            expect(config.body).toEqual([
                { key: 'a', value: '1', type: 'text' },
                { key: 'b', value: '2', type: 'text' }
            ]);
        });

        test('should assemble binary bodies with variable substitution', async () => {
            stubPersisted({
                mode: 'binary',
                filePath: '{{dir}}/payload.bin',
                contentType: 'application/pdf'
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, { dir: '/tmp' });

            expect(config.bodyType).toBe('binary');
            expect(config.body).toEqual({
                filePath: '/tmp/payload.bin',
                contentType: 'application/pdf'
            });
        });

        test('refuses a binary body with no file path, like the editor does', async () => {
            stubPersisted({
                mode: 'binary',
                filePath: ''
            });

            await expect(service._buildRequestConfig(collection, endpoint, {}))
                .rejects.toThrow('No file selected for binary body');
        });

        test('sends text-mode bodies as text instead of a JSON string literal', async () => {
            stubPersisted({ mode: 'text', content: 'hello {{name}}' });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, { name: 'ada' });

            expect(config.bodyType).toBe('text');
            expect(config.body).toBe('hello ada');
        });

        test('rejects an invalid JSON body instead of sending it as a quoted string', async () => {
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                headers: [], modifiedBody: 'not json', formBodyData: null, queryParams: [], pathParams: []
            });

            await expect(service._buildRequestConfig(collection, endpoint, {}))
                .rejects.toThrow('Invalid Body JSON');
        });
    });

    describe('_buildRequestConfig parity with the editor send path', () => {
        let collection;

        const stubPersisted = (overrides = {}) => {
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                url: null,
                headers: [],
                modifiedBody: null,
                formBodyData: null,
                graphqlData: null,
                queryParams: [],
                pathParams: [],
                ...overrides
            });
        };

        beforeEach(() => {
            stubPersisted();
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue(null);
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue(null);
            collection = { id: 'c1', baseUrl: 'https://api.test', defaultHeaders: {} };
        });

        test('builds a GraphQL POST from the persisted query, variables and operation name', async () => {
            stubPersisted({
                graphqlData: {
                    query: 'query Get($id: ID!) { user(id: $id) { name } }',
                    variables: '{"id": "{{userId}}"}',
                    operationName: 'Get'
                }
            });
            const endpoint = { id: 'e1', method: 'GET', protocol: 'graphql', path: '/graphql' };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, { userId: '7' });

            expect(config.method).toBe('POST');
            expect(config.url).toBe('https://api.test/graphql');
            expect(config.body).toEqual({
                query: 'query Get($id: ID!) { user(id: $id) { name } }',
                variables: { id: '7' },
                operationName: 'Get'
            });
        });

        test('keeps empty-valued and duplicate query params in order', async () => {
            stubPersisted({
                queryParams: [
                    { key: 'tag', value: 'a' },
                    { key: 'flag', value: '' },
                    { key: 'tag', value: 'b' },
                    { key: 'off', value: 'x', enabled: false }
                ]
            });
            const endpoint = { id: 'e1', method: 'GET', path: '/items' };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.url).toBe('https://api.test/items?tag=a&flag=&tag=b');
        });

        test('uses the persisted editor URL when the endpoint has one', async () => {
            stubPersisted({ url: 'https://other.test/v2/items' });
            const endpoint = { id: 'e1', method: 'GET', path: '/items' };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.url).toBe('https://other.test/v2/items');
        });

        test('substitutes OpenAPI single-brace path parameters', async () => {
            const endpoint = {
                id: 'e1',
                method: 'GET',
                path: '/users/{id}',
                parameters: { path: { id: { example: '42' } } }
            };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.url).toBe('https://api.test/users/42');
        });

        test('passes the TLS and redirect settings through', async () => {
            mockBackendAPI.settings.get.mockResolvedValue({ verifySsl: false, followRedirects: false, requestTimeout: 0 });
            const endpoint = { id: 'e1', method: 'GET', path: '/items' };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.verifySsl).toBe(false);
            expect(config.followRedirects).toBe(false);
            expect(config.timeout).toBeNull();
        });

        test('adds api-key query auth to the URL', async () => {
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue({
                type: 'api-key',
                config: { keyName: 'api_key', keyValue: '{{key}}', location: 'query' }
            });
            const endpoint = { id: 'e1', method: 'GET', path: '/items' };

            const { requestConfig: config, authData } = await service._buildRequestConfig(collection, endpoint, { key: 's3cret' });

            expect(config.url).toBe('https://api.test/items?api_key=s3cret');
            expect(authData.queryParams).toEqual({ api_key: 's3cret' });
        });

        test('falls back to the bearerToken variable for an empty bearer token', async () => {
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue({
                type: 'bearer',
                config: { token: '' }
            });
            const endpoint = { id: 'e1', method: 'GET', path: '/items' };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, { bearerToken: 'tok' });

            expect(config.headers['Authorization']).toBe('Bearer tok');
        });

        test('interpolates variables into NTLM credentials', async () => {
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue({
                type: 'ntlm',
                config: { username: '{{u}}', password: '{{p}}', domain: 'CORP', workstation: '' }
            });
            const endpoint = { id: 'e1', method: 'GET', path: '/items' };

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, { u: 'ada', p: 'pw' });

            expect(config.ntlm).toEqual({ username: 'ada', password: 'pw', domain: 'CORP', workstation: '' });
        });
    });

    describe('_buildRequestConfig with collection auth inheritance', () => {
        let endpoint;
        let collection;

        beforeEach(() => {
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                headers: [],
                modifiedBody: null,
                formBodyData: null,
                queryParams: [],
                pathParams: []
            });
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue(null);
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue(null);

            collection = { id: 'c1', baseUrl: '', defaultHeaders: {} };
            endpoint = { id: 'e1', method: 'GET', path: 'https://api.test/users' };
        });

        test('endpoint without persisted auth inherits the collection auth', async () => {
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue({
                type: 'bearer',
                config: { token: 'shared-token' }
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(service.collectionRepository.getInheritedAuthConfig).toHaveBeenCalledWith('c1', 'e1');
            expect(config.headers['Authorization']).toBe('Bearer shared-token');
        });

        test('explicit persisted none opts out of collection auth', async () => {
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue({
                type: 'none',
                config: {}
            });
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue({
                type: 'bearer',
                config: { token: 'shared-token' }
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.headers['Authorization']).toBeUndefined();
        });

        test('persisted endpoint auth wins over collection auth', async () => {
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue({
                type: 'bearer',
                config: { token: 'endpoint-token' }
            });
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue({
                type: 'bearer',
                config: { token: 'shared-token' }
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.headers['Authorization']).toBe('Bearer endpoint-token');
        });

        test('persisted inherit resolves to collection auth with variable substitution', async () => {
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue({
                type: 'inherit',
                config: {}
            });
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue({
                type: 'bearer',
                config: { token: '{{apiToken}}' }
            });

            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {
                apiToken: 'resolved-secret'
            });

            expect(config.headers['Authorization']).toBe('Bearer resolved-secret');
        });

        test('inherit with no collection auth sends unauthenticated', async () => {
            const { requestConfig: config } = await service._buildRequestConfig(collection, endpoint, {});

            expect(config.headers['Authorization']).toBeUndefined();
        });
    });

    describe('_executeRequest test-result handling', () => {
        const request = {
            collectionId: 'c1',
            endpointId: 'e1',
            name: 'R1',
            method: 'GET',
            path: '/x',
            postResponseScript: 'pm.test("x", () => {})'
        };

        beforeEach(() => {
            service._buildVariables = jest.fn().mockResolvedValue({});
            service.collectionRepository.getById = jest
                .fn()
                .mockResolvedValue({ id: 'c1', endpoints: [{ id: 'e1', method: 'GET', path: '/x' }] });
            service._buildRequestConfig = jest.fn().mockResolvedValue({
                requestConfig: { url: 'http://api.test/x', method: 'GET', headers: {}, queryParams: {}, pathParams: {} },
                rawUrl: 'http://api.test/x',
                authData: { headers: {}, queryParams: {} },
                mockRewrite: null
            });
            mockBackendAPI.sendApiRequest.mockResolvedValue({
                success: true,
                status: 200,
                data: {},
                headers: {}
            });
        });

        test('marks the request failed when an assertion fails', async () => {
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: {},
                logs: [],
                errors: [],
                testResults: [{ passed: false, message: 'expected 201' }]
            });

            const result = await service._executeRequest(request, {}, 0);

            expect(result.status).toBe('error');
            expect(result.httpSuccess).toBe(true);
            expect(result.testResults).toHaveLength(1);
            expect(result.error).toContain('1 test failed');
            expect(result.error).toContain('expected 201');
        });

        test('keeps the request passing when all assertions pass', async () => {
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: {},
                logs: [],
                errors: [],
                testResults: [{ passed: true, message: 'status is 200' }]
            });

            const result = await service._executeRequest(request, {}, 0);

            expect(result.status).toBe('success');
            expect(result.httpSuccess).toBe(true);
        });

        test('marks the request failed when the script throws', async () => {
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: {},
                logs: [],
                errors: ['ReferenceError: foo is not defined'],
                testResults: []
            });

            const result = await service._executeRequest(request, {}, 0);

            expect(result.status).toBe('error');
            expect(result.scriptError).toContain('ReferenceError');
            expect(result.error).toContain('Script error');
        });

        test('still extracts variables when an assertion fails (chaining preserved)', async () => {
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: { token: 'abc' },
                logs: [],
                errors: [],
                testResults: [{ passed: false, message: 'body has id' }]
            });

            const result = await service._executeRequest(request, {}, 0);

            expect(result.status).toBe('error');
            expect(result.httpSuccess).toBe(true);
            expect(result.variablesSet).toEqual({ token: 'abc' });
        });
    });

    describe('_executeRequest through the shared script and cookie pipeline', () => {
        const request = { collectionId: 'c1', endpointId: 'e1', name: 'R1', method: 'GET', path: '/x' };
        const collection = {
            id: 'c1',
            baseUrl: 'https://api.test',
            defaultHeaders: {},
            endpoints: [{ id: 'e1', method: 'GET', path: '/x' }]
        };

        beforeEach(() => {
            service.collectionRepository.getById = jest.fn().mockResolvedValue(collection);
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                url: null, headers: [], modifiedBody: null, formBodyData: null, graphqlData: null, queryParams: [], pathParams: []
            });
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue(null);
            service.collectionRepository.getInheritedAuthConfig = jest.fn().mockResolvedValue(null);
            service.variableRepository.getVariablesForCollection = jest.fn().mockResolvedValue({});
            service.environmentRepository.getActiveEnvironmentVariables = jest.fn().mockResolvedValue({});
            service.certificateService.getItems = jest.fn().mockResolvedValue([]);
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: {}, logs: [], errors: [], testResults: []
            });
        });

        test('runs tests on a 404 and passes when they pass', async () => {
            mockBackendAPI.sendApiRequest.mockResolvedValue({
                success: false, status: 404, statusText: 'Not Found', data: { error: 'nope' }, headers: {}
            });
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: {}, logs: [], errors: [], testResults: [{ passed: true, message: 'is 404' }]
            });

            const result = await service._executeRequest(
                { ...request, postResponseScript: 'pm.test("is 404", () => {})' }, {}, 0
            );

            expect(mockBackendAPI.scripts.executeTest).toHaveBeenCalledTimes(1);
            expect(mockBackendAPI.scripts.executeTest.mock.calls[0][0].response.status).toBe(404);
            expect(result.status).toBe('success');
            expect(result.httpSuccess).toBe(false);
            expect(result.statusCode).toBe(404);
        });

        test('fails a non-2xx response without tests and reports the status', async () => {
            mockBackendAPI.sendApiRequest.mockResolvedValue({
                success: false, status: 500, statusText: 'Internal Server Error', data: null, headers: {}
            });

            const result = await service._executeRequest(request, {}, 0);

            expect(result.status).toBe('error');
            expect(result.error).toBe('500 Internal Server Error');
        });

        test('runs the endpoint pre-request and test scripts before the runner script', async () => {
            app.scriptController.getScriptsForEndpoint.mockResolvedValue({
                preRequestScript: 'pre()',
                testScript: 'endpointTest()'
            });
            mockBackendAPI.scripts.executePreRequest.mockResolvedValue({
                success: true,
                logs: [{ level: 'log', message: 'pre ran', timestamp: 1 }],
                errors: [],
                testResults: [],
                modifiedEnvironment: { token: 'abc' },
                modifiedRequest: { headers: { 'X-Signed': '1' } }
            });
            mockBackendAPI.sendApiRequest.mockResolvedValue({ success: true, status: 200, data: {}, headers: {} });

            const result = await service._executeRequest({ ...request, postResponseScript: 'runnerTest()' }, {}, 0);

            const sent = mockBackendAPI.sendApiRequest.mock.calls[0][0];
            expect(sent.headers['X-Signed']).toBe('1');
            const scriptsRun = mockBackendAPI.scripts.executeTest.mock.calls.map(([data]) => data.script);
            expect(scriptsRun).toEqual(['endpointTest()', 'runnerTest()']);
            expect(mockBackendAPI.scripts.executeTest.mock.calls[0][0].environment.token).toBe('abc');
            expect(mockEnvironmentService.setVariable).toHaveBeenCalledWith('env1', 'token', 'abc', false);
            expect(result.variablesSet).toEqual({ token: 'abc' });
            expect(result.logs).toEqual([{ level: 'log', message: 'pre ran', timestamp: 1 }]);
        });

        test('sends jar cookies and stores Set-Cookie values', async () => {
            app.cookieController = {
                getCookieHeader: jest.fn().mockResolvedValue('sid=1'),
                handleCookiesFromResponse: jest.fn().mockResolvedValue(undefined)
            };
            mockBackendAPI.sendApiRequest.mockResolvedValue({
                success: true, status: 200, data: {}, headers: {}, setCookies: ['sid=2; Path=/']
            });

            await service._executeRequest(request, {}, 0);

            expect(mockBackendAPI.sendApiRequest.mock.calls[0][0].headers['Cookie']).toBe('sid=1');
            expect(app.cookieController.handleCookiesFromResponse)
                .toHaveBeenCalledWith(['sid=2; Path=/'], 'https://api.test/x');
        });

        test('records a history entry for each request', async () => {
            app.historyController = { addHistoryEntry: jest.fn().mockResolvedValue(undefined) };
            mockBackendAPI.sendApiRequest.mockResolvedValue({ success: true, status: 200, data: {}, headers: {} });

            await service._executeRequest(request, {}, 0);

            expect(app.historyController.addHistoryEntry).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'https://api.test/x' }),
                expect.objectContaining({ status: 200 }),
                { collectionId: 'c1', endpointId: 'e1' },
                null,
                { headerNames: [], queryNames: [] }
            );
        });

        test('refuses protocols the runner cannot drive', async () => {
            service.collectionRepository.getById = jest.fn().mockResolvedValue({
                ...collection,
                endpoints: [{ id: 'e1', method: 'GET', path: '/x', protocol: 'sse' }]
            });

            const result = await service._executeRequest(request, {}, 0);

            expect(result.status).toBe('error');
            expect(result.error).toContain('sse');
            expect(mockBackendAPI.sendApiRequest).not.toHaveBeenCalled();
        });

        test('an unset variable is removed from later requests', async () => {
            const variables = await service._buildVariables('c1', { token: null });

            expect(variables).not.toHaveProperty('token');
        });
    });

    describe('iterations and data files', () => {
        beforeEach(() => {
            service._buildRunContext = jest.fn().mockResolvedValue(null);
        });

        test('repeats the whole queue for each iteration with flat indexes', async () => {
            service._executeRequest = jest.fn().mockImplementation(async (request, vars, index) => ({
                index, name: request.name, status: 'success', variablesSet: {}
            }));

            const results = await service.executeRunnerData({
                requests: [{ name: 'A' }, { name: 'B' }],
                options: { iterations: 3 }
            });

            expect(results.totalRequests).toBe(6);
            expect(results.iterations).toBe(3);
            expect(results.requests.map(r => `${r.iteration}:${r.name}:${r.index}`))
                .toEqual(['1:A:0', '1:B:1', '2:A:2', '2:B:3', '3:A:4', '3:B:5']);
        });

        test('clamps the iteration count to 1..1000', async () => {
            service._executeRequest = jest.fn().mockResolvedValue({ status: 'success', variablesSet: {} });

            const zero = await service.executeRunnerData({ requests: [{}], options: { iterations: 0 } });
            expect(zero.iterations).toBe(1);
            const many = await service.executeRunnerData({ requests: [{}], options: { iterations: 5000 } });
            expect(many.iterations).toBe(1000);
        });

        test('runs once per data row and passes each row to its requests', async () => {
            mockBackendAPI.runner = {
                readDataFile: jest.fn().mockResolvedValue({ name: 'users.csv', content: 'email\nada@x.io\nbob@x.io\n' })
            };
            service._executeRequest = jest.fn().mockResolvedValue({ status: 'success', variablesSet: {} });
            const started = [];
            service.addListener((event, data) => event === 'run-started' && started.push(data));

            const results = await service.executeRunnerData({
                requests: [{ name: 'A' }],
                options: { iterations: 7, dataFile: { path: '/data/users.csv', name: 'users.csv' } }
            });

            expect(mockBackendAPI.runner.readDataFile).toHaveBeenCalledWith('/data/users.csv');
            expect(results.iterations).toBe(2);
            expect(service._executeRequest.mock.calls.map(call => call[4])).toEqual([
                { email: 'ada@x.io' },
                { email: 'bob@x.io' }
            ]);
            expect(started[0].iterationLabels).toEqual(['email=ada@x.io', 'email=bob@x.io']);
        });

        test('names the data file when it cannot be read', async () => {
            mockBackendAPI.runner = { readDataFile: jest.fn().mockRejectedValue('Cannot read data file /x: No such file') };

            await expect(service.executeRunnerData({
                requests: [{}],
                options: { dataFile: { path: '/x/users.csv', name: 'users.csv' } }
            })).rejects.toThrow('Data file users.csv: Cannot read data file /x: No such file');
            expect(service.isExecuting()).toBe(false);
        });

        test('rejects a data file without rows', async () => {
            mockBackendAPI.runner = { readDataFile: jest.fn().mockResolvedValue({ name: 'e.csv', content: 'email\n' }) };

            await expect(service.executeRunnerData({
                requests: [{}],
                options: { dataFile: { path: '/e.csv', name: 'e.csv' } }
            })).rejects.toThrow('Data file e.csv has no rows');
        });

        test('data row values win over environment and script-set variables', async () => {
            service.variableRepository.getVariablesForCollection = jest.fn().mockResolvedValue({ user: 'collection' });
            const runContext = { collectionVars: new Map(), envVars: { user: 'env', other: 'env' } };

            const variables = await service._buildVariables('c1', { user: 'script' }, runContext, { user: 'row' });

            expect(variables).toEqual({ user: 'row', other: 'env' });
        });

        test('stop-on-error skips every remaining iteration', async () => {
            service._executeRequest = jest.fn()
                .mockResolvedValueOnce({ status: 'success', variablesSet: {} })
                .mockResolvedValueOnce({ status: 'error', variablesSet: {} });

            const results = await service.executeRunnerData({
                requests: [{ name: 'A' }, { name: 'B' }],
                options: { iterations: 3, stopOnError: true }
            });

            expect(results.failed).toBe(1);
            expect(results.skipped).toBe(4);
        });
    });

    describe('stopping and progress', () => {
        test('stop cuts a delay short and skips the rest', async () => {
            service._buildRunContext = jest.fn().mockResolvedValue(null);
            service._executeRequest = jest.fn().mockResolvedValue({ status: 'success', variablesSet: {} });

            const run = service.executeRunnerData({ requests: [{}, {}], options: { delayMs: 60000 } });
            await new Promise(resolve => setTimeout(resolve, 0));
            service.stopExecution();
            const results = await run;

            expect(service._executeRequest).toHaveBeenCalledTimes(1);
            expect(results.skipped).toBe(1);
        });

        test('stop abandons an in-flight request', async () => {
            service._buildRunContext = jest.fn().mockResolvedValue(null);
            service._executeRequest = jest.fn().mockReturnValue(new Promise(() => {}));

            const run = service.executeRunnerData({ requests: [{}, {}], options: {} });
            await new Promise(resolve => setTimeout(resolve, 0));
            service.stopExecution();
            const results = await run;

            expect(results.skipped).toBe(2);
            expect(service.isExecuting()).toBe(false);
        });

        test('a failing request reports progress before stop-on-error halts the run', async () => {
            service._buildRunContext = jest.fn().mockResolvedValue(null);
            service._executeRequest = jest.fn().mockResolvedValue({ status: 'error', variablesSet: {} });
            const onProgress = jest.fn();
            const completed = [];
            service.addListener((event, data) => {
                if (event === 'request-completed') {
                    completed.push(data.index);
                }
            });

            await service.executeRunnerData({ requests: [{}, {}], options: { stopOnError: true } }, onProgress);

            expect(onProgress).toHaveBeenCalledWith(0, 2, expect.objectContaining({ status: 'error' }));
            expect(completed).toEqual([0]);
        });
    });

    describe('saved vs unsaved runs differ only in identity and last-run bookkeeping', () => {
        beforeEach(() => {
            service._executeRequest = jest
                .fn()
                .mockResolvedValue({ index: 0, status: 'success', httpSuccess: true, variablesSet: {} });
        });

        test('a saved run carries its id and name and stamps last-run', async () => {
            mockRepository.getById.mockResolvedValue({
                id: 'runner_1',
                name: 'Smoke',
                requests: [{}],
                options: {}
            });
            const started = [];
            service.addListener((event, data) => {
                if (event === 'run-started') {
                    started.push(data);
                }
            });

            const results = await service.executeRunner('runner_1');

            expect(results.runnerId).toBe('runner_1');
            expect(results.runnerName).toBe('Smoke');
            expect(started).toEqual([{ runnerId: 'runner_1', total: 1, iterations: 1, iterationLabels: null }]);
            expect(mockRepository.updateLastRun).toHaveBeenCalledWith('runner_1');
        });

        test('an unsaved run has a null id, a default name, and never stamps last-run', async () => {
            const started = [];
            service.addListener((event, data) => {
                if (event === 'run-started') {
                    started.push(data);
                }
            });

            const results = await service.executeRunnerData({ requests: [{}], options: {} });

            expect(results.runnerId).toBeNull();
            expect(results.runnerName).toBe('Untitled Runner');
            expect(started).toEqual([{ runnerId: null, total: 1, iterations: 1, iterationLabels: null }]);
            expect(mockRepository.updateLastRun).not.toHaveBeenCalled();
        });

        test('a saved runner with no name keeps its name undefined', async () => {
            mockRepository.getById.mockResolvedValue({ id: 'runner_1', requests: [{}], options: {} });

            const results = await service.executeRunner('runner_1');

            expect(results.runnerName).toBeUndefined();
        });

        test('an unsaved run keeps an explicit name', async () => {
            const results = await service.executeRunnerData({ name: 'Ad hoc', requests: [{}], options: {} });

            expect(results.runnerName).toBe('Ad hoc');
        });

        test('both paths release the running lock and emit run-completed', async () => {
            mockRepository.getById.mockResolvedValue({ id: 'runner_1', name: 'S', requests: [{}], options: {} });
            const completed = [];
            service.addListener((event, data) => {
                if (event === 'run-completed') {
                    completed.push(data);
                }
            });

            await service.executeRunner('runner_1');
            expect(service.isRunning).toBe(false);
            expect(service.currentRunId).toBeNull();

            await service.executeRunnerData({ requests: [{}], options: {} });
            expect(service.isRunning).toBe(false);
            expect(service.currentRunId).toBeNull();

            expect(completed).toHaveLength(2);
            expect(completed[0].runnerId).toBe('runner_1');
            expect(completed[1].runnerId).toBeNull();
        });

        test('a saved run still stamps last-run when a request throws', async () => {
            mockRepository.getById.mockResolvedValue({ id: 'runner_1', name: 'S', requests: [{}], options: {} });
            service._executeRequest = jest.fn().mockRejectedValue(new Error('boom'));

            await expect(service.executeRunner('runner_1')).rejects.toThrow('boom');

            expect(mockRepository.updateLastRun).toHaveBeenCalledWith('runner_1');
            expect(service.isRunning).toBe(false);
        });
    });

    describe('executeRunnerData aggregation', () => {
        test('counts assertion failures as failed and still chains their variables', async () => {
            service._executeRequest = jest
                .fn()
                .mockResolvedValueOnce({ index: 0, status: 'success', httpSuccess: true, variablesSet: { a: '1' } })
                .mockResolvedValueOnce({ index: 1, status: 'error', httpSuccess: true, variablesSet: { b: '2' } })
                .mockResolvedValueOnce({ index: 2, status: 'success', httpSuccess: true, variablesSet: {} });

            const results = await service.executeRunnerData({
                name: 'R',
                requests: [{}, {}, {}],
                options: {}
            });

            expect(results.passed).toBe(2);
            expect(results.failed).toBe(1);
            expect(results.variablesSet).toEqual({ a: '1', b: '2' });
        });

        test('stopOnError halts the run on an assertion failure', async () => {
            service._executeRequest = jest
                .fn()
                .mockResolvedValueOnce({ index: 0, status: 'error', httpSuccess: true, variablesSet: {} });

            const results = await service.executeRunnerData({
                name: 'R',
                requests: [{}, {}, {}],
                options: { stopOnError: true }
            });

            expect(results.failed).toBe(1);
            expect(results.skipped).toBe(2);
            expect(service._executeRequest).toHaveBeenCalledTimes(1);
        });
    });

    describe('dynamic variables per request', () => {
        test('two requests in one run resolve {{$uuid}} independently', async () => {
            const collection = {
                id: 'c1',
                baseUrl: '',
                defaultHeaders: {},
                endpoints: [{ id: 'e1', method: 'GET', path: 'https://api.test/items/{{$uuid}}' }]
            };
            service.collectionRepository.getById = jest.fn().mockResolvedValue(collection);
            service.collectionRepository.getAllPersistedEndpointData = jest.fn().mockResolvedValue({
                headers: [], modifiedBody: null, formBodyData: null, queryParams: [], pathParams: []
            });
            service.collectionRepository.getPersistedAuthConfig = jest.fn().mockResolvedValue(null);
            service.variableRepository.getVariablesForCollection = jest.fn().mockResolvedValue({});
            service.environmentRepository.getActiveEnvironmentVariables = jest.fn().mockResolvedValue({});
            service.certificateService.getItems = jest.fn().mockResolvedValue([]);
            mockBackendAPI.sendApiRequest.mockResolvedValue({ success: true, status: 200, data: {}, headers: {} });

            const request = { collectionId: 'c1', endpointId: 'e1', name: 'r', method: 'GET', path: '/items' };
            await service._executeRequest(request, {}, 0);
            await service._executeRequest(request, {}, 1);

            const urls = mockBackendAPI.sendApiRequest.mock.calls.map(([config]) => config.url);
            expect(urls[0]).toMatch(/items\/[0-9a-f-]{36}$/);
            expect(urls[0]).not.toBe(urls[1]);
        });
    });
});
