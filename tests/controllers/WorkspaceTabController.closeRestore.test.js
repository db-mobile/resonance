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

describe('WorkspaceTabController close paths do not revert the active tab', () => {
    let controller;
    let service;
    let stateManager;

    beforeEach(() => {
        jest.clearAllMocks();
        service = {
            addListener: jest.fn(),
            getActiveTabId: jest.fn().mockResolvedValue('tab-A'),
            getAllTabs: jest.fn().mockResolvedValue([
                { id: 'tab-A', type: 'http' },
                { id: 'tab-B', type: 'http' },
                { id: 'tab-C', type: 'http' }
            ]),
            switchTab: jest.fn(async (id) => ({ id, type: 'http' })),
            closeTab: jest.fn(),
            updateTab: jest.fn().mockResolvedValue(undefined)
        };
        stateManager = {
            captureCurrentState: jest.fn().mockResolvedValue({ endpoint: null }),
            restoreTabState: jest.fn().mockResolvedValue(undefined)
        };
        controller = new WorkspaceTabController(
            service,
            { render: jest.fn(), setActiveTab: jest.fn(), updateTab: jest.fn() },
            stateManager,
            { showContainer: jest.fn(), removeContainer: jest.fn() }
        );
    });

    test('closing a background tab never restores the still-active tab', async () => {
        service.closeTab.mockResolvedValue({ newActiveTabId: 'tab-A' });

        await controller.closeTab('tab-B');

        expect(stateManager.restoreTabState).not.toHaveBeenCalled();
    });

    test('closing the active tab activates and restores the successor', async () => {
        service.closeTab.mockResolvedValue({ newActiveTabId: 'tab-B' });

        await controller.closeTab('tab-A');

        expect(stateManager.restoreTabState).toHaveBeenCalledTimes(1);
        expect(stateManager.restoreTabState).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'tab-B' })
        );
    });

    test('closeOtherTabs keeping the active tab does not restore it', async () => {
        service.closeTab.mockResolvedValue({ newActiveTabId: 'tab-A' });

        await controller.closeOtherTabs('tab-A');

        expect(stateManager.restoreTabState).not.toHaveBeenCalled();
    });

    test('closeOtherTabs keeping a background tab activates it', async () => {
        service.closeTab.mockResolvedValue({ newActiveTabId: 'tab-B' });
        service.getAllTabs
            .mockResolvedValueOnce([
                { id: 'tab-A', type: 'http' },
                { id: 'tab-B', type: 'http' },
                { id: 'tab-C', type: 'http' }
            ])
            .mockResolvedValue([{ id: 'tab-B', type: 'http' }]);

        await controller.closeOtherTabs('tab-B');

        expect(stateManager.restoreTabState).toHaveBeenCalledTimes(1);
        expect(stateManager.restoreTabState).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'tab-B' })
        );
    });
});
