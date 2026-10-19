/* global window */
import { RunnerService } from '../../src/modules/services/RunnerService.js';
import { ScriptService } from '../../src/modules/services/ScriptService.js';
import { CertificateService } from '../../src/modules/services/CertificateService.js';
import { CertificateRepository } from '../../src/modules/storage/CertificateRepository.js';
import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';
import { EnvironmentRepository } from '../../src/modules/storage/EnvironmentRepository.js';
import { MockServerRepository } from '../../src/modules/storage/MockServerRepository.js';
import { MockServerService } from '../../src/modules/services/MockServerService.js';
import { createRequestPipeline } from '../../src/modules/requestPipeline.feature.js';
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

        const pipeline = createRequestPipeline({
            backendAPI: mockBackendAPI,
            secretStore: null,
            statusDisplay: mockStatusDisplay,
            collectionRepository: new CollectionRepository(mockBackendAPI, null),
            environmentRepository: new EnvironmentRepository(mockBackendAPI, null),
            mockServerService: new MockServerService(new MockServerRepository(mockBackendAPI), null),
            certificates: new CertificateService(new CertificateRepository(mockBackendAPI)),
            cookies: { getCookieHeader: (url) => app.cookieController?.getCookieHeader(url) ?? null }
        });
        service = new RunnerService(mockRepository, mockBackendAPI, mockStatusDisplay, { pipeline });

        mockEnvironmentService = {
            getActiveEnvironment: jest.fn().mockResolvedValue({ id: 'env1', name: 'Dev', secretKeys: [] }),
            getActiveEnvironmentVariables: jest.fn().mockResolvedValue({}),
            applyVariableChanges: jest.fn().mockResolvedValue(undefined),
            deleteVariable: jest.fn().mockResolvedValue(undefined)
        };
        window.backendAPI = mockBackendAPI;
        app.scriptController = {
            service: new ScriptService(null, mockEnvironmentService, null, null, { backendAPI: mockBackendAPI }),
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

    describe('listeners', () => {
        test('should add listener', () => {
            const listener = jest.fn();

            service.addListener(listener);

            expect(service.listeners).toContain(listener);
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

});

describe('Rust runner adapter lifecycle', () => {
    function setup() {
        const repository = { getById: jest.fn(async () => ({ name: 'Saved', requests: [{ endpointId: 'e' }] })), updateLastRun: jest.fn() };
        const service = new RunnerService(repository, {}, null, { pipeline: {} });
        const snapshot = { requests: [{ name: 'Frozen' }], context: { environmentId: 'pinned' }, options: {} };
        service.core.captureRun = jest.fn(async () => snapshot);
        service.core.execute = jest.fn(async (_kind, _input, _execution, emit) => {
            emit({ kind: 'run-started', data: { total: 4 } });
            emit({ kind: 'request-completed', data: { index: 0, result: { name: 'Frozen', status: 'success' } } });
            return { passed: 1, totalRequests: 1, requests: [{ name: 'Frozen' }] };
        });
        const events = [];
        service.addListener((kind, data) => events.push({ kind, data }));
        return { service, repository, snapshot, events };
    }
    test('saved runs use captured inputs, report planned totals, and stamp last-run', async () => {
        const { service, repository, snapshot, events } = setup();
        const progress = jest.fn();
        const result = await service.executeRunner('saved-id', progress);
        expect(service.core.execute).toHaveBeenCalledWith('run', { ...snapshot, runnerId: 'saved-id', runnerName: 'Saved' }, expect.any(Object), expect.any(Function));
        expect(progress).toHaveBeenCalledWith(0, 4, expect.objectContaining({ status: 'success' }));
        expect(repository.updateLastRun).toHaveBeenCalledWith('saved-id');
        expect(result.runnerId).toBe('saved-id');
        expect(service.isRunning).toBe(false);
        expect(events.filter(e => e.kind === 'run-completed')).toHaveLength(1);
    });
    test('unsaved runs preserve their name and do not stamp a repository entry', async () => {
        const { service, repository } = setup();
        const result = await service.executeRunnerData({ name: 'Temporary', requests: [{}] });
        expect(result.runnerId).toBeNull(); expect(result.runnerName).toBe('Temporary');
        expect(repository.updateLastRun).not.toHaveBeenCalled();
    });
    test.each(['capture', 'ipc', 'bookkeeping'])('%s failure releases the lock and completes exactly once', async phase => {
        const { service, repository, events } = setup();
        if (phase === 'capture') { service.core.captureRun.mockRejectedValue(new Error('capture failed')); }
        if (phase === 'ipc') { service.core.execute.mockRejectedValue(new Error('ipc failed')); }
        if (phase === 'bookkeeping') { repository.updateLastRun.mockRejectedValue(new Error('bookkeeping failed')); }
        const result = await service.executeRunner('saved-id');
        expect(result.error).toContain('failed'); expect(service.isRunning).toBe(false);
        expect(events.filter(e => e.kind === 'run-completed')).toHaveLength(1);
    });
});
