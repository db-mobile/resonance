/* global document, window */
import { RunnerController } from '../../src/modules/controllers/RunnerController.js';

jest.mock('../../src/modules/storage/RunnerRepository.js', () => {
    const RunnerRepository = jest.fn().mockImplementation(() => ({
        getAll: jest.fn(),
        getAllByCollection: jest.fn(),
        getById: jest.fn(),
        findById: jest.fn(),
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
        findRunner: jest.fn(),
        createRunner: jest.fn(),
        updateRunner: jest.fn(),
        deleteRunner: jest.fn(),
        executeRunner: jest.fn(),
        executeRunnerData: jest.fn(),
        getEndpointRequestConfig: jest.fn(),
        stopExecution: jest.fn(),
        addListener: jest.fn()
    }))
}));

jest.mock('../../src/modules/ui/RunnerPanel.js', () => ({
    RunnerPanel: jest.fn().mockImplementation(() => ({
        render: jest.fn(),
        loadRunner: jest.fn(),
        showResults: jest.fn(),
        updateResultWithResponse: jest.fn(),
        getRunnerData: jest.fn(),
        loadPreset: jest.fn(),
        setRunSummary: jest.fn(),
        prepareResults: jest.fn(),
        setDataFile: jest.fn(),
        currentRunnerId: null,
        collectionId: null,
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

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { success: jest.fn(), warning: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

const { toast } = require('../../src/modules/ui/Toast.js');

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
            collections: {
                runners: {
                    readData: jest.fn()
                }
            },
            runner: {
                pickDataFile: jest.fn()
            }
        };

        mockGetCollections = jest.fn().mockResolvedValue([
            { id: 'collection_1', name: 'Test Collection', storagePath: '/work/test-collection' }
        ]);

        window.backendAPI = mockBackendAPI;
        controller = new RunnerController(mockBackendAPI, mockGetCollections);
    });

    afterEach(() => {
        delete window.backendAPI;
    });

    describe('constructor', () => {
        test('should initialize with backendAPI and getCollections', () => {
            expect(controller.backendAPI).toBe(mockBackendAPI);
            expect(controller.getCollections).toBe(mockGetCollections);
            expect(controller.panel).toBeNull();
            expect(controller.currentRunnerId).toBeNull();
            expect(controller.currentCollectionId).toBeNull();
        });

        test('should create repository and service', () => {
            expect(controller.repository).toBeDefined();
            expect(controller.service).toBeDefined();
        });
    });

    describe('initialize', () => {
        test('should create panel and set up callbacks', async () => {
            await controller.initialize(document.createElement('div'));

            expect(controller.panel).toBeDefined();
            expect(controller.panel.render).toHaveBeenCalled();
            expect(controller.service.addListener).toHaveBeenCalled();
        });

        test('loads the last runner by scanning every collection for its id', async () => {
            mockBackendAPI.settings.get.mockResolvedValue({ lastRunnerId: 'runner_1' });
            controller.service.findRunner.mockResolvedValue({ id: 'runner_1', collectionId: 'collection_1', name: 'Last Runner', requests: [] });
            controller.service.getRunner.mockResolvedValue({ id: 'runner_1', collectionId: 'collection_1', name: 'Last Runner', requests: [] });

            await controller.initialize(document.createElement('div'));

            expect(controller.service.findRunner).toHaveBeenCalledWith('runner_1');
            expect(controller.service.getRunner).toHaveBeenCalledWith('collection_1', 'runner_1');
            expect(controller.currentCollectionId).toBe('collection_1');
        });
    });

    describe('_handleSave', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        test('names an unnamed runner "Untitled Runner" when saving', async () => {
            controller.service.createRunner.mockResolvedValue({ id: 'runner_new' });

            await controller._handleSave({ name: '', collectionId: 'collection_1', requests: [] });

            expect(controller.service.createRunner).toHaveBeenCalledWith('collection_1', { name: 'Untitled Runner', collectionId: 'collection_1', requests: [] });
        });

        test('creates a new runner in the runner data collection when none is current', async () => {
            const runnerData = { name: 'New Runner', collectionId: 'collection_1', requests: [] };
            controller.service.createRunner.mockResolvedValue({ id: 'runner_new', ...runnerData });

            await controller._handleSave(runnerData);

            expect(controller.service.createRunner).toHaveBeenCalledWith('collection_1', runnerData);
            expect(controller.currentRunnerId).toBe('runner_new');
            expect(controller.currentCollectionId).toBe('collection_1');
        });

        test('updates the current runner inside its own collection', async () => {
            controller._currentCollectionId = 'collection_1';
            controller.currentRunnerId = 'runner_1';
            const runnerData = { name: 'Updated Runner', collectionId: 'collection_1', requests: [] };
            controller.service.updateRunner.mockResolvedValue({ id: 'runner_1', ...runnerData });

            await controller._handleSave(runnerData);

            expect(controller.service.updateRunner).toHaveBeenCalledWith('collection_1', 'runner_1', runnerData);
        });

        test('refuses to save a runner that has no collection yet', async () => {
            await controller._handleSave({ name: 'Lonely', collectionId: null, requests: [] });

            expect(controller.service.createRunner).not.toHaveBeenCalled();
            expect(toast.error).toHaveBeenCalledWith('Add a request first so the runner belongs to a collection');
        });
    });

    describe('_handleLoadRunners', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        test('returns fresh runners grouped by collection', async () => {
            controller.service.getAllRunners.mockResolvedValue([
                { id: 'runner_1', name: 'Runner 1', collectionId: 'collection_1', requests: [] },
                { id: 'runner_2', name: 'Runner 2', collectionId: 'other', requests: [] }
            ]);

            const groups = await controller._handleLoadRunners();

            expect(controller.service.getAllRunners).toHaveBeenCalledWith({ fresh: true });
            expect(groups.map(g => [g.name, g.runners.map(r => r.id)])).toEqual([
                ['Test Collection', ['runner_1']],
                ['other', ['runner_2']]
            ]);
        });

        test('should return empty array on error', async () => {
            controller.service.getAllRunners.mockRejectedValue(new Error('Error'));

            expect(await controller._handleLoadRunners()).toEqual([]);
        });
    });

    describe('_handleRunnerSelect', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        test('loads the selected runner from its collection and checks its data file there', async () => {
            const runner = { id: 'runner_1', collectionId: 'collection_1', name: 'Test Runner', requests: [], options: { dataFile: { path: 'data/users.csv', name: 'users.csv' } } };
            controller.service.getRunner.mockResolvedValue(runner);
            mockBackendAPI.collections.runners.readData.mockResolvedValue({ name: 'users.csv', content: 'id\n1\n2\n' });

            await controller._handleRunnerSelect('runner_1', 'collection_1');
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(controller.service.getRunner).toHaveBeenCalledWith('collection_1', 'runner_1');
            expect(controller.currentRunnerId).toBe('runner_1');
            expect(controller.currentCollectionId).toBe('collection_1');
            expect(controller.panel.loadRunner).toHaveBeenCalledWith(runner, new Set());
            expect(mockBackendAPI.collections.runners.readData).toHaveBeenCalledWith('collection_1', 'data/users.csv');
            expect(controller.panel.setDataFile).toHaveBeenCalledWith(runner.options.dataFile, { rowCount: 2, portable: true });
        });

        test('does not touch the repository when nothing was re-linked', async () => {
            mockGetCollections.mockResolvedValue([{ id: 'c1', name: 'API', endpoints: [{ id: 'e1', method: 'GET', path: '/x' }] }]);
            controller.service.getRunner.mockResolvedValue({
                id: 'runner_1', collectionId: 'c1', name: 'Old',
                requests: [{ collectionId: 'c1', endpointId: 'e1', overrides: { headers: [{ key: 'X-A', value: 'edited' }] } }]
            });

            await controller._handleRunnerSelect('runner_1', 'c1');

            const loaded = controller.panel.loadRunner.mock.calls[0][0];
            expect(loaded).not.toHaveProperty('overridesVersion');
            expect(controller.repository.update).not.toHaveBeenCalled();
        });
    });

    describe('keeping the panel in step with the saved runner', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        test('a runner created by Run is known to the panel, so history and delete work', async () => {
            controller.service.createRunner.mockResolvedValue({ id: 'runner_new' });
            controller.service.executeRunner.mockResolvedValue({ requests: [] });

            await controller._handleRun({ name: 'Named', collectionId: 'collection_1', requests: [{}] });

            expect(controller.panel.currentRunnerId).toBe('runner_new');
            expect(controller.service.executeRunner).toHaveBeenCalledWith('collection_1', 'runner_new', expect.any(Function));
        });

        test('a runner created by Save is known to the panel', async () => {
            controller.service.createRunner.mockResolvedValue({ id: 'runner_saved' });

            await controller._handleSave({ name: 'Named', collectionId: 'collection_1', requests: [] });

            expect(controller.panel.currentRunnerId).toBe('runner_saved');
        });
    });

    describe('run history and export', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
            controller.historyRepository = { record: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue(), list: jest.fn() };
        });

        const results = {
            runnerId: 'runner_1', runnerName: 'Smoke', startTime: Date.UTC(2026, 8, 22, 10, 5), endTime: 0, totalTime: 12,
            iterations: 1, passed: 1, failed: 0, skipped: 0,
            requests: [{ iteration: 1, name: 'List', method: 'GET', status: 'success', statusCode: 200, time: 12, testResults: [] }]
        };

        test('records a summary for a saved runner and hands it to the panel', async () => {
            controller._currentCollectionId = 'collection_1';
            controller.currentRunnerId = 'runner_1';
            controller.service.updateRunner.mockResolvedValue({});
            controller.service.executeRunner.mockResolvedValue(results);

            await controller._handleRun({ name: 'Smoke', collectionId: 'collection_1', requests: [{}] });

            expect(controller.panel.setRunSummary).toHaveBeenCalledWith(expect.objectContaining({ runnerName: 'Smoke' }));
            expect(controller.historyRepository.record).toHaveBeenCalledWith('runner_1', expect.objectContaining({
                summary: { passed: 1, failed: 0, skipped: 0 }
            }));
        });

        test('keeps no history for an unsaved run', async () => {
            controller.service.executeRunnerData.mockResolvedValue({ ...results, runnerId: null });

            await controller._handleRun({ name: '', collectionId: 'collection_1', requests: [{}] });

            expect(controller.panel.setRunSummary).toHaveBeenCalled();
            expect(controller.historyRepository.record).not.toHaveBeenCalled();
        });

        test.each(['json', 'junit'])('exports %s through the native report command', async (format) => {
            mockBackendAPI.runner.saveReport = jest.fn().mockResolvedValue({ success: true, filePath: '/tmp/r.xml' });
            const summary = { runnerName: 'Smoke', startedAt: 0, iterations: 1, totalTime: 0, requests: [] };

            await controller._exportReport(format, summary);

            const extension = format === 'junit' ? 'xml' : 'json';
            expect(mockBackendAPI.runner.saveReport).toHaveBeenCalledWith(
                expect.stringMatching(new RegExp(`^smoke-\\d{8}-\\d{4}\\.${extension}$`)), format, summary
            );
            expect(toast.success).toHaveBeenCalledWith('Report saved to /tmp/r.xml');
        });

        test('cancelling report export does not show a success or error', async () => {
            mockBackendAPI.runner.saveReport = jest.fn().mockResolvedValue({ cancelled: true });

            await controller._exportReport('json', { requests: [] });

            expect(toast.success).not.toHaveBeenCalled();
            expect(toast.error).not.toHaveBeenCalled();
        });

        test('report failures are shown to the user', async () => {
            mockBackendAPI.runner.saveReport = jest.fn().mockRejectedValue(new Error('Disk full'));

            await controller._exportReport('json', { requests: [] });

            expect(toast.error).toHaveBeenCalledWith('Could not save the report: Disk full');
        });

        test('deleting a runner removes it from its collection and deletes its history', async () => {
            const { ConfirmDialog } = await import('../../src/modules/ui/ConfirmDialog.js');
            ConfirmDialog.mockImplementation(() => ({ show: jest.fn().mockResolvedValue(true) }));
            controller.panel.startNewRunner = jest.fn();
            controller._currentCollectionId = 'collection_1';
            controller.currentRunnerId = 'runner_1';
            controller.service.deleteRunner.mockResolvedValue(true);

            await controller._handleRunnerDelete('runner_1');

            expect(controller.service.deleteRunner).toHaveBeenCalledWith('collection_1', 'runner_1');
            expect(controller.historyRepository.remove).toHaveBeenCalledWith('runner_1');
            expect(controller.currentCollectionId).toBeNull();
        });
    });

    describe('opening with a preset', () => {
        test('fills the queue from the preset instead of loading the last runner', async () => {
            mockBackendAPI.settings.get.mockResolvedValue({ lastRunnerId: 'runner_1' });
            const preset = { name: 'API / pets', requests: [{ collection: { id: 'c1' }, endpoint: { id: 'e1' } }] };

            await controller.initialize(document.createElement('div'), preset);

            expect(controller.panel.loadPreset).toHaveBeenCalledWith(preset);
            expect(controller.service.findRunner).not.toHaveBeenCalled();
            expect(controller.currentRunnerId).toBeNull();
        });
    });

    describe('re-linking orphaned requests', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        const orphan = {
            collectionId: 'own-collection',
            endpointId: 'old-endpoint',
            name: 'Get all albums',
            method: 'GET',
            path: '/albums',
            overrides: {}
        };

        test('re-links a request to the one matching endpoint within the runner collection', async () => {
            mockGetCollections.mockResolvedValue([{
                id: 'own-collection',
                name: 'JSONPlaceholder API',
                endpoints: [{ id: 'new-endpoint', name: 'Get all albums', method: 'GET', path: '/albums' }]
            }]);
            controller.service.getRunner.mockResolvedValue({ id: 'r1', collectionId: 'own-collection', name: 'testy', requests: [orphan] });

            await controller._handleRunnerSelect('r1', 'own-collection');

            const [loaded, missing] = controller.panel.loadRunner.mock.calls[0];
            expect(loaded.requests[0]).toMatchObject({ collectionId: 'own-collection', endpointId: 'new-endpoint' });
            expect(missing.size).toBe(0);
            expect(controller.repository.update).toHaveBeenCalledWith('own-collection', 'r1', { requests: loaded.requests });
        });

        test('a matching endpoint in another collection does not count: the request is reported missing', async () => {
            mockGetCollections.mockResolvedValue([
                { id: 'own-collection', name: 'Own', endpoints: [] },
                { id: 'other-collection', name: 'Other', endpoints: [{ id: 'elsewhere', name: 'Get all albums', method: 'GET', path: '/albums' }] }
            ]);
            controller.service.getRunner.mockResolvedValue({ id: 'r1', collectionId: 'own-collection', name: 'testy', requests: [orphan] });

            await controller._handleRunnerSelect('r1', 'own-collection');

            const [loaded, missing] = controller.panel.loadRunner.mock.calls[0];
            expect(loaded.requests[0].endpointId).toBe('old-endpoint');
            expect([...missing]).toEqual([0]);
            expect(controller.repository.update).not.toHaveBeenCalled();
        });
    });

    describe('data files', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
            controller.panel.collectionId = 'collection_1';
        });

        test('a file inside the collection is stored relative and marked portable', async () => {
            mockBackendAPI.runner.pickDataFile.mockResolvedValue({ path: '/work/test-collection/data/users.csv', name: 'users.csv', content: 'id\n1\n' });

            const picked = await controller._pickDataFile();

            expect(picked).toEqual({ path: 'data/users.csv', name: 'users.csv', rowCount: 1, portable: true });
        });

        test('a file outside the collection keeps its absolute path and is not portable', async () => {
            mockBackendAPI.runner.pickDataFile.mockResolvedValue({ path: '/elsewhere/users.csv', name: 'users.csv', content: 'id\n1\n' });

            const picked = await controller._pickDataFile();

            expect(picked).toEqual({ path: '/elsewhere/users.csv', name: 'users.csv', rowCount: 1, portable: false });
        });

        test('picking a data file needs a collection first', async () => {
            controller.panel.collectionId = null;

            expect(await controller._pickDataFile()).toBeNull();
            expect(mockBackendAPI.runner.pickDataFile).not.toHaveBeenCalled();
            expect(toast.error).toHaveBeenCalledWith('Add a request first so the runner belongs to a collection');
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
            await controller.initialize(document.createElement('div'));
        });

        test('should reset currentRunnerId and the bound collection', () => {
            controller._currentCollectionId = 'collection_1';
            controller.currentRunnerId = 'runner_1';

            controller._handleNewRunner();

            expect(controller.currentRunnerId).toBeNull();
            expect(controller.currentCollectionId).toBeNull();
            expect(controller.panel.currentRunnerId).toBeNull();
        });
    });

    describe('_handleRun', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        test('should execute saved runner', async () => {
            controller._currentCollectionId = 'collection_1';
            controller.currentRunnerId = 'runner_1';
            const runnerData = { name: 'Test Runner', collectionId: 'collection_1', requests: [{ id: 'req_1' }] };
            const results = { passed: 1, failed: 0 };

            controller.service.updateRunner.mockResolvedValue({ id: 'runner_1', ...runnerData });
            controller.service.executeRunner.mockResolvedValue(results);

            await controller._handleRun(runnerData);

            expect(controller.service.updateRunner).toHaveBeenCalledWith('collection_1', 'runner_1', runnerData);
            expect(controller.service.executeRunner).toHaveBeenCalledWith('collection_1', 'runner_1', expect.any(Function));
            expect(controller.panel.showResults).toHaveBeenCalledWith(results);
        });

        test('should execute unsaved runner with executeRunnerData', async () => {
            const runnerData = { name: '', collectionId: 'collection_1', requests: [{ id: 'req_1' }] };
            const results = { passed: 1, failed: 0 };

            controller.service.executeRunnerData.mockResolvedValue(results);

            await controller._handleRun(runnerData);

            expect(controller.service.createRunner).not.toHaveBeenCalled();
            expect(controller.service.executeRunnerData).toHaveBeenCalledWith(runnerData, expect.any(Function));
            expect(controller.panel.showResults).toHaveBeenCalledWith(results);
        });

        test('should create runner if named and not saved', async () => {
            const runnerData = { name: 'Named Runner', collectionId: 'collection_1', requests: [{ id: 'req_1' }] };
            const createdRunner = { id: 'runner_new', ...runnerData };
            const results = { passed: 1, failed: 0 };

            controller.service.createRunner.mockResolvedValue(createdRunner);
            controller.service.executeRunner.mockResolvedValue(results);

            await controller._handleRun(runnerData);

            expect(controller.service.createRunner).toHaveBeenCalledWith('collection_1', runnerData);
            expect(controller.currentRunnerId).toBe('runner_new');
        });
    });

    describe('_handleStop', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
        });

        test('should call service stopExecution', () => {
            controller._handleStop();

            expect(controller.service.stopExecution).toHaveBeenCalled();
        });
    });

    describe('_handleServiceEvent', () => {
        const { updateStatusDisplay } = require('../../src/modules/statusDisplay.js');

        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
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

    describe('_saveLastRunnerId', () => {
        beforeEach(async () => {
            await controller.initialize(document.createElement('div'));
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
