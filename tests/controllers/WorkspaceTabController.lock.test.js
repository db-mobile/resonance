import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';

jest.mock('../../src/modules/state/pendingSaves.js', () => ({
    flushPendingSaves: jest.fn().mockResolvedValue(undefined),
    registerPendingSave: jest.fn(),
    cancelPendingSaves: jest.fn()
}));
jest.mock('../../src/modules/websocketHandler.js', () => ({
    clearWebSocketState: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/modules/sseHandler.js', () => ({
    clearSseState: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/modules/mqttHandler.js', () => ({
    clearMqttState: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/modules/grpcStreamHandler.js', () => ({
    clearStreamState: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../src/modules/graphqlSubscriptionHandler.js', () => ({
    clearGraphQLSubscriptionState: jest.fn().mockResolvedValue(undefined),
    handleGraphQLSubscriptionCancel: jest.fn().mockResolvedValue(undefined),
    isSubscriptionActive: jest.fn().mockReturnValue(false)
}));
jest.mock('../../src/modules/services/WorkspaceTabEndpointLoaderService.js', () => ({
    WorkspaceTabEndpointLoaderService: jest.fn().mockImplementation(() => ({}))
}));

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WorkspaceTabController lifecycle lock', () => {
    let controller;
    let service;
    let stateManager;
    let tabBar;

    beforeEach(() => {
        jest.clearAllMocks();
        service = {
            addListener: jest.fn(),
            getActiveTabId: jest.fn().mockResolvedValue('tab-A'),
            getAllTabs: jest.fn().mockResolvedValue([{ id: 'tab-A' }, { id: 'tab-B' }, { id: 'tab-C' }]),
            switchTab: jest.fn(async (id) => ({ id, type: 'http' })),
            createTab: jest.fn(async () => ({ id: 'tab-new', type: 'http' })),
            closeTab: jest.fn().mockResolvedValue({ newActiveTabId: 'tab-A' }),
            updateTab: jest.fn().mockResolvedValue(undefined),
            setTabModified: jest.fn().mockResolvedValue(undefined)
        };
        stateManager = {
            captureCurrentState: jest.fn().mockResolvedValue({ endpoint: null }),
            restoreTabState: jest.fn().mockResolvedValue(undefined)
        };
        tabBar = { render: jest.fn(), setActiveTab: jest.fn(), updateTab: jest.fn() };
        controller = new WorkspaceTabController(service, tabBar, stateManager, {
            showContainer: jest.fn(),
            removeContainer: jest.fn()
        });
    });

    test('a second switch waits until the first restore has completed', async () => {
        let releaseFirstRestore;
        stateManager.restoreTabState
            .mockImplementationOnce(() => new Promise((resolve) => {
                releaseFirstRestore = resolve;
            }))
            .mockResolvedValue(undefined);

        const first = controller.switchTab('tab-B');
        await flushMicrotasks();
        const second = controller.switchTab('tab-C');
        await flushMicrotasks();

        expect(service.switchTab).toHaveBeenCalledTimes(1);
        expect(service.switchTab).toHaveBeenCalledWith('tab-B');

        releaseFirstRestore();
        await Promise.all([first, second]);

        expect(service.switchTab).toHaveBeenCalledTimes(2);
        expect(service.switchTab).toHaveBeenLastCalledWith('tab-C');
    });

    test('a burst of switches coalesces to the newest target', async () => {
        const first = controller.switchTab('tab-B');
        const second = controller.switchTab('tab-C');
        await Promise.all([first, second]);

        expect(service.switchTab).toHaveBeenCalledTimes(1);
        expect(service.switchTab).toHaveBeenCalledWith('tab-C');
    });

    test('closing the last tab creates a replacement without deadlocking', async () => {
        service.getAllTabs
            .mockResolvedValueOnce([{ id: 'tab-A' }])
            .mockResolvedValue([{ id: 'tab-new' }]);
        service.getActiveTabId
            .mockResolvedValueOnce('tab-A')
            .mockResolvedValue('tab-new');

        await controller.closeTab('tab-A');

        expect(service.createTab).toHaveBeenCalledTimes(1);
        expect(service.closeTab).toHaveBeenCalledWith('tab-A');
        expect(tabBar.render).toHaveBeenCalled();
    });
});
