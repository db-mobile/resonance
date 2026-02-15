/* global document */
import { RunnerController } from '../../src/modules/controllers/RunnerController.js';

// Mock the dependencies
jest.mock('../../src/modules/storage/RunnerRepository.js', () => ({
    RunnerRepository: jest.fn().mockImplementation(() => ({
        getAll: jest.fn(),
        getById: jest.fn(),
        add: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        updateLastRun: jest.fn()
    }))
}));

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
            const runner = { id: 'runner_1', name: 'Test Runner' };
            controller.service.getRunner.mockResolvedValue(runner);

            await controller._handleRunnerSelect('runner_1');

            expect(controller.currentRunnerId).toBe('runner_1');
            expect(controller.panel.loadRunner).toHaveBeenCalledWith(runner);
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

            // Should not throw
            await controller._saveLastRunnerId('runner_1');
        });
    });
});
