import { RunnerService } from '../../src/modules/services/RunnerService.js';

describe('RunnerService', () => {
    let service;
    let mockRepository;
    let mockBackendAPI;
    let mockStatusDisplay;

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
                executeTest: jest.fn()
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
            const results = { requests: [], skipped: 0 };

            service._markRemainingAsSkipped(requests, results, 1, 'Test reason');

            expect(results.requests).toHaveLength(2);
            expect(results.requests[0].status).toBe('skipped');
            expect(results.requests[0].error).toBe('Test reason');
            expect(results.requests[0].index).toBe(1);
            expect(results.skipped).toBe(2);
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

    describe('_generateAuthData', () => {
        test('should return empty auth data for no auth config', () => {
            const result = service._generateAuthData(null, {});

            expect(result).toEqual({
                headers: {},
                queryParams: {},
                authConfig: null
            });
        });

        test('should return empty auth data for none type', () => {
            const result = service._generateAuthData({ type: 'none' }, {});

            expect(result).toEqual({
                headers: {},
                queryParams: {},
                authConfig: null
            });
        });

        test('should generate bearer auth header', () => {
            const authConfig = {
                type: 'bearer',
                config: { token: 'my-token' }
            };

            const result = service._generateAuthData(authConfig, {});

            expect(result.headers['Authorization']).toBe('Bearer my-token');
        });

        test('should generate bearer auth from variable', () => {
            const authConfig = {
                type: 'bearer',
                config: {}
            };
            const variables = { bearerToken: 'var-token' };

            const result = service._generateAuthData(authConfig, variables);

            expect(result.headers['Authorization']).toBe('Bearer var-token');
        });

        test('should generate basic auth header', () => {
            const authConfig = {
                type: 'basic',
                config: { username: 'user', password: 'pass' }
            };

            const result = service._generateAuthData(authConfig, {});

            const expectedCredentials = btoa('user:pass');
            expect(result.headers['Authorization']).toBe(`Basic ${expectedCredentials}`);
        });

        test('should generate api-key header', () => {
            const authConfig = {
                type: 'api-key',
                config: { keyName: 'X-API-Key', keyValue: 'secret', location: 'header' }
            };

            const result = service._generateAuthData(authConfig, {});

            expect(result.headers['X-API-Key']).toBe('secret');
        });

        test('should generate api-key query param', () => {
            const authConfig = {
                type: 'api-key',
                config: { keyName: 'api_key', keyValue: 'secret', location: 'query' }
            };

            const result = service._generateAuthData(authConfig, {});

            expect(result.queryParams['api_key']).toBe('secret');
        });

        test('should generate oauth2 auth header', () => {
            const authConfig = {
                type: 'oauth2',
                config: { token: 'oauth-token', headerPrefix: 'Bearer' }
            };

            const result = service._generateAuthData(authConfig, {});

            expect(result.headers['Authorization']).toBe('Bearer oauth-token');
        });

        test('should generate digest auth config', () => {
            const authConfig = {
                type: 'digest',
                config: { username: 'user', password: 'pass' }
            };

            const result = service._generateAuthData(authConfig, {});

            expect(result.authConfig).toEqual({ username: 'user', password: 'pass' });
        });

        test('should process variables in auth values', () => {
            const authConfig = {
                type: 'bearer',
                config: { token: '{{apiToken}}' }
            };
            const variables = { apiToken: 'resolved-token' };

            const result = service._generateAuthData(authConfig, variables);

            expect(result.headers['Authorization']).toBe('Bearer resolved-token');
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

    describe('_executePostResponseScript', () => {
        test('should return empty result for empty script', async () => {
            const result = await service._executePostResponseScript('', {}, {}, {});

            expect(result).toEqual({ variablesSet: {}, logs: [] });
        });

        test('should return empty result for whitespace-only script', async () => {
            const result = await service._executePostResponseScript('   ', {}, {}, {});

            expect(result).toEqual({ variablesSet: {}, logs: [] });
        });

        test('should execute script and return variables', async () => {
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: { newVar: 'value', nullVar: null },
                logs: ['log1', 'log2'],
                errors: []
            });

            const result = await service._executePostResponseScript(
                'console.log("test")',
                { url: 'http://test.com', method: 'GET' },
                { status: 200, body: {} },
                { existingVar: 'existing' }
            );

            expect(result.variablesSet).toEqual({ newVar: 'value' });
            expect(result.logs).toEqual(['log1', 'log2']);
            expect(result.error).toBeNull();
        });

        test('should return error from script execution', async () => {
            mockBackendAPI.scripts.executeTest.mockResolvedValue({
                modifiedEnvironment: {},
                logs: [],
                errors: ['Script error 1', 'Script error 2']
            });

            const result = await service._executePostResponseScript(
                'invalid script',
                {},
                {},
                {}
            );

            expect(result.error).toBe('Script error 1; Script error 2');
        });

        test('should handle script execution failure', async () => {
            mockBackendAPI.scripts.executeTest.mockRejectedValue(new Error('Execution failed'));

            const result = await service._executePostResponseScript(
                'console.log("test")',
                {},
                {},
                {}
            );

            expect(result.variablesSet).toEqual({});
            expect(result.error).toBe('Execution failed');
        });
    });
});
