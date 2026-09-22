/* global document */
import { RunnerController } from '../../src/modules/controllers/RunnerController.js';

// Mock the dependencies
jest.mock('../../src/modules/storage/RunnerRepository.js', () => {
    const RunnerRepository = jest.fn().mockImplementation(() => ({
        getAll: jest.fn(),
        getById: jest.fn(),
        add: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        updateLastRun: jest.fn()
    }));
    RunnerRepository.shared = jest.fn((backendAPI) => new RunnerRepository(backendAPI));
    return { RunnerRepository };
});

jest.mock('../../src/modules/services/RunnerService.js', () => ({
    RunnerService: jest.fn().mockImplementation(() => ({
        getAllRunners: jest.fn(),
        getRunner: jest.fn(),
        createRunner: jest.fn(),
        updateRunner: jest.fn(),
        deleteRunner: jest.fn(),
        executeRunner: jest.fn(),
        executeRunnerData: jest.fn(),
        stopExecution: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn()
    }))
}));

jest.mock('../../src/modules/ui/RunnerPanel.js', () => ({
    RunnerPanel: jest.fn().mockImplementation(() => ({
        render: jest.fn(),
        loadRunner: jest.fn(),
        showResults: jest.fn(),
        updateResultWithResponse: jest.fn(),
        getRunnerData: jest.fn(),
        _handleNewRunner: jest.fn(),
        currentRunnerId: null,
        onRunnerSave: null,
        onLoadRunners: null,
        onRunnerSelect: null,
        onNewRunner: null,
        onRunnerDelete: null,
        onRun: null,
        onStop: null
    }))
}));

jest.mock('../../src/modules/ui/ConfirmDialog.js', () => ({
    ConfirmDialog: jest.fn().mockImplementation(() => ({
        show: jest.fn()
    }))
}));

jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn()
}));

jest.mock('../../src/modules/templateLoader.js', () => ({
    templateLoader: {
        cloneSync: jest.fn()
    }
}));

describe('RunnerController', () => {
    let controller;
    let mockBackendAPI;
    let mockGetCollections;

    beforeEach(() => {
        jest.clearAllMocks();

        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn()
            },
            settings: {
                get: jest.fn().mockResolvedValue({}),
                set: jest.fn()
            },
            sendApiRequest: jest.fn(),
            scripts: {
                executeTest: jest.fn()
            }
        };

        mockGetCollections = jest.fn().mockResolvedValue([
            { id: 'collection_1', name: 'Test Collection' }
        ]);

        controller = new RunnerController(mockBackendAPI, mockGetCollections);
    });

    describe('constructor', () => {
        test('should initialize with backendAPI and getCollections', () => {
            expect(controller.backendAPI).toBe(mockBackendAPI);
            expect(controller.getCollections).toBe(mockGetCollections);
            expect(controller.panel).toBeNull();
            expect(controller.currentRunnerId).toBeNull();
        });

        test('should create repository and service', () => {
            expect(controller.repository).toBeDefined();
            expect(controller.service).toBeDefined();
        });
    });

    describe('initialize', () => {
        test('should create panel and set up callbacks', async () => {
            const mockContainer = document.createElement('div');
            mockBackendAPI.settings.get.mockResolvedValue({});

            await controller.initialize(mockContainer);

            expect(controller.panel).toBeDefined();
            expect(controller.panel.render).toHaveBeenCalled();
            expect(controller.service.addListener).toHaveBeenCalled();
        });

        test('should load last runner on initialization', async () => {
            const mockContainer = document.createElement('div');
            mockBackendAPI.settings.get.mockResolvedValue({ lastRunnerId: 'runner_1' });
            controller.service.getRunner.mockResolvedValue({
                id: 'runner_1',
                name: 'Last Runner'
            });

            await controller.initialize(mockContainer);

            expect(controller.service.getRunner).toHaveBeenCalledWith('runner_1');
        });
    });

    describe('_handleSave', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should create new runner when no currentRunnerId', async () => {
            const runnerData = { name: 'New Runner', requests: [] };
            controller.service.createRunner.mockResolvedValue({
                id: 'runner_new',
                ...runnerData
            });

            await controller._handleSave(runnerData);

            expect(controller.service.createRunner).toHaveBeenCalledWith(runnerData);
            expect(controller.currentRunnerId).toBe('runner_new');
        });

        test('should update existing runner when currentRunnerId exists', async () => {
            controller.currentRunnerId = 'runner_1';
            const runnerData = { name: 'Updated Runner', requests: [] };
            controller.service.updateRunner.mockResolvedValue({
                id: 'runner_1',
                ...runnerData
            });

            await controller._handleSave(runnerData);

            expect(controller.service.updateRunner).toHaveBeenCalledWith('runner_1', runnerData);
        });
    });

    describe('_handleLoadRunners', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should return all runners from service', async () => {
            const runners = [
                { id: 'runner_1', name: 'Runner 1' },
                { id: 'runner_2', name: 'Runner 2' }
            ];
            controller.service.getAllRunners.mockResolvedValue(runners);

            const result = await controller._handleLoadRunners();

            expect(result).toEqual(runners);
        });

        test('should return empty array on error', async () => {
            controller.service.getAllRunners.mockRejectedValue(new Error('Error'));

            const result = await controller._handleLoadRunners();

            expect(result).toEqual([]);
        });
    });

    describe('_handleRunnerSelect', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should load selected runner', async () => {
            const runner = { id: 'runner_1', name: 'Test Runner', overridesVersion: 2, requests: [] };
            controller.service.getRunner.mockResolvedValue(runner);

            await controller._handleRunnerSelect('runner_1');

            expect(controller.currentRunnerId).toBe('runner_1');
            expect(controller.panel.loadRunner).toHaveBeenCalledWith(runner, new Set());
        });

        test('migrates snapshot overrides once, keeping only real edits', async () => {
            mockGetCollections.mockResolvedValue([{ id: 'c1', name: 'API', endpoints: [{ id: 'e1', method: 'GET', path: '/x' }] }]);
            controller.service.getEndpointRequestConfig = jest.fn().mockResolvedValue({
                pathParams: [],
                queryParams: [{ key: 'page', value: '1', enabled: true }],
                headers: [{ key: 'X-A', value: 'a' }],
                body: '{"a":1}'
            });
            controller.service.getRunner.mockResolvedValue({
                id: 'runner_1',
                name: 'Old',
                requests: [{
                    collectionId: 'c1',
                    endpointId: 'e1',
                    overrides: {
                        pathParams: [],
                        queryParams: [{ key: 'page', value: '1' }],
                        headers: [{ key: 'X-A', value: 'edited' }],
                        body: '{"a":1}'
                    }
                }]
            });

            await controller._handleRunnerSelect('runner_1');

            const loaded = controller.panel.loadRunner.mock.calls[0][0];
            expect(loaded.overridesVersion).toBe(2);
            expect(loaded.requests[0].overrides).toEqual({ headers: [{ key: 'X-A', value: 'edited' }] });
            expect(controller.repository.update).toHaveBeenCalledWith('runner_1', {
                requests: loaded.requests,
                overridesVersion: 2
            });
        });
    });

    describe('re-linking orphaned requests', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        const orphan = {
            collectionId: 'old-collection',
            endpointId: 'old-endpoint',
            name: 'Get all albums',
            method: 'GET',
            path: '/albums',
            overrides: {}
        };

        test('re-links a request to the one open endpoint with the same method, path and name', async () => {
            mockGetCollections.mockResolvedValue([{
                id: 'new-collection',
                name: 'JSONPlaceholder API',
                endpoints: [{ id: 'new-endpoint', name: 'Get all albums', method: 'GET', path: '/albums' }]
            }]);
            controller.service.getRunner.mockResolvedValue({ id: 'r1', name: 'testy', overridesVersion: 2, requests: [orphan] });

            await controller._handleRunnerSelect('r1');

            const [loaded, missing] = controller.panel.loadRunner.mock.calls[0];
            expect(loaded.requests[0]).toMatchObject({ collectionId: 'new-collection', endpointId: 'new-endpoint' });
            expect(missing.size).toBe(0);
            expect(controller.repository.update).toHaveBeenCalledWith('r1', {
                requests: loaded.requests,
                overridesVersion: 2
            });
        });

        test('flags a request as missing when no single endpoint matches', async () => {
            mockGetCollections.mockResolvedValue([{
                id: 'new-collection',
                endpoints: [
                    { id: 'a', name: 'Get all albums', method: 'GET', path: '/albums' },
                    { id: 'b', name: 'Get all albums', method: 'GET', path: '/albums' }
                ]
            }]);
            controller.service.getRunner.mockResolvedValue({ id: 'r1', name: 'testy', overridesVersion: 2, requests: [orphan] });

            await controller._handleRunnerSelect('r1');

            const [loaded, missing] = controller.panel.loadRunner.mock.calls[0];
            expect(loaded.requests[0].collectionId).toBe('old-collection');
            expect([...missing]).toEqual([0]);
            expect(controller.repository.update).not.toHaveBeenCalled();
        });
    });

    describe('destroy', () => {
        test('stops a running execution and unsubscribes from collection updates', async () => {
            const unsubscribe = jest.fn();
            const subscribe = jest.fn().mockReturnValue(unsubscribe);
            controller = new RunnerController(mockBackendAPI, mockGetCollections, subscribe);
            await controller.initialize(document.createElement('div'));
            controller.panel.destroy = jest.fn();
            controller.panel.updateCollections = jest.fn();

            subscribe.mock.calls[0][0]([{ id: 'c2' }]);
            controller.destroy();

            expect(controller.panel.updateCollections).toHaveBeenCalledWith([{ id: 'c2' }]);
            expect(controller.service.stopExecution).toHaveBeenCalled();
            expect(unsubscribe).toHaveBeenCalled();
        });
    });

    describe('_handleNewRunner', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should reset currentRunnerId', () => {
            controller.currentRunnerId = 'runner_1';

            controller._handleNewRunner();

            expect(controller.currentRunnerId).toBeNull();
            expect(controller.panel.currentRunnerId).toBeNull();
        });
    });

    describe('_handleRun', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should execute saved runner', async () => {
            controller.currentRunnerId = 'runner_1';
            const runnerData = { name: 'Test Runner', requests: [{ id: 'req_1' }] };
            const results = { passed: 1, failed: 0 };

            controller.service.updateRunner.mockResolvedValue({ id: 'runner_1', ...runnerData });
            controller.service.executeRunner.mockResolvedValue(results);

            await controller._handleRun(runnerData);

            expect(controller.service.updateRunner).toHaveBeenCalledWith('runner_1', runnerData);
            expect(controller.service.executeRunner).toHaveBeenCalled();
            expect(controller.panel.showResults).toHaveBeenCalledWith(results);
        });

        test('should execute unsaved runner with executeRunnerData', async () => {
            controller.currentRunnerId = null;
            const runnerData = { name: 'Untitled Runner', requests: [{ id: 'req_1' }] };
            const results = { passed: 1, failed: 0 };

            controller.service.executeRunnerData.mockResolvedValue(results);

            await controller._handleRun(runnerData);

            expect(controller.service.executeRunnerData).toHaveBeenCalled();
            expect(controller.panel.showResults).toHaveBeenCalledWith(results);
        });

        test('should create runner if named and not saved', async () => {
            controller.currentRunnerId = null;
            const runnerData = { name: 'Named Runner', requests: [{ id: 'req_1' }] };
            const createdRunner = { id: 'runner_new', ...runnerData };
            const results = { passed: 1, failed: 0 };

            controller.service.createRunner.mockResolvedValue(createdRunner);
            controller.service.updateRunner.mockResolvedValue(createdRunner);
            controller.service.executeRunner.mockResolvedValue(results);

            await controller._handleRun(runnerData);

            expect(controller.service.createRunner).toHaveBeenCalledWith(runnerData);
            expect(controller.currentRunnerId).toBe('runner_new');
        });
    });

    describe('_handleStop', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should call service stopExecution', () => {
            controller._handleStop();

            expect(controller.service.stopExecution).toHaveBeenCalled();
        });
    });

    describe('_handleServiceEvent', () => {
        const { updateStatusDisplay } = require('../../src/modules/statusDisplay.js');

        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should handle run-started event', () => {
            controller._handleServiceEvent('run-started', { total: 5 });

            expect(updateStatusDisplay).toHaveBeenCalledWith('Running 5 requests...', null);
        });

        test('should handle request-completed success event', () => {
            controller._handleServiceEvent('request-completed', {
                index: 0,
                result: { status: 'success', statusCode: 200 }
            });

            expect(updateStatusDisplay).toHaveBeenCalledWith('Request 1: 200', 200);
        });

        test('should handle request-completed error event', () => {
            controller._handleServiceEvent('request-completed', {
                index: 0,
                result: { status: 'error', error: 'Connection failed' }
            });

            expect(updateStatusDisplay).toHaveBeenCalledWith('Request 1: Connection failed', null);
        });

        test('should handle run-completed event', () => {
            controller._handleServiceEvent('run-completed', {
                passed: 3,
                failed: 1,
                totalTime: 1500
            });

            expect(updateStatusDisplay).toHaveBeenCalledWith(
                'Completed: 3 passed, 1 failed (1500ms)',
                null
            );
        });

        test('should show success status when all passed', () => {
            controller._handleServiceEvent('run-completed', {
                passed: 5,
                failed: 0,
                totalTime: 1000
            });

            expect(updateStatusDisplay).toHaveBeenCalledWith(
                'Completed: 5 passed, 0 failed (1000ms)',
                200
            );
        });
    });

    describe('static methods', () => {
        test('createRunnerTab should return runner tab config', () => {
            const tab = RunnerController.createRunnerTab();

            expect(tab).toEqual({
                type: 'runner',
                name: 'Collection Runner',
                icon: 'play'
            });
        });

        test('isRunnerTab should return true for runner tabs', () => {
            expect(RunnerController.isRunnerTab({ type: 'runner' })).toBe(true);
            expect(RunnerController.isRunnerTab({ type: 'request' })).toBe(false);
            expect(RunnerController.isRunnerTab(null)).toBe(false);
        });
    });

    describe('_saveLastRunnerId', () => {
        beforeEach(async () => {
            const mockContainer = document.createElement('div');
            await controller.initialize(mockContainer);
        });

        test('should save runner ID to settings', async () => {
            mockBackendAPI.settings.get.mockResolvedValue({ otherSetting: 'value' });

            await controller._saveLastRunnerId('runner_1');

            expect(mockBackendAPI.settings.set).toHaveBeenCalledWith({
                otherSetting: 'value',
                lastRunnerId: 'runner_1'
            });
        });

        test('should handle errors gracefully', async () => {
            mockBackendAPI.settings.get.mockRejectedValue(new Error('Settings error'));

            await controller._saveLastRunnerId('runner_1');
        });
    });
});
