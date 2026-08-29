import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';
import { flushPendingSaves } from '../../src/modules/state/pendingSaves.js';

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

describe('WorkspaceTabController flushes pending saves before context switches', () => {
    let controller;
    let service;
    let stateManager;

    beforeEach(() => {
        jest.clearAllMocks();
        service = {
            addListener: jest.fn(),
            getActiveTabId: jest.fn().mockResolvedValue('tab-1'),
            getAllTabs: jest.fn().mockResolvedValue([{ id: 'tab-1' }, { id: 'tab-2' }]),
            updateTab: jest.fn().mockResolvedValue(undefined),
            closeTab: jest.fn().mockResolvedValue(null)
        };
        stateManager = {
            captureCurrentState: jest.fn().mockResolvedValue({ endpoint: null })
        };
        controller = new WorkspaceTabController(service, {}, stateManager, { removeContainer: jest.fn() });
    });

    test('_saveCurrentTabState flushes pending saves before capturing the DOM', async () => {
        await controller._saveCurrentTabState();

        expect(flushPendingSaves).toHaveBeenCalledTimes(1);
        expect(stateManager.captureCurrentState).toHaveBeenCalledTimes(1);
        expect(flushPendingSaves.mock.invocationCallOrder[0])
            .toBeLessThan(stateManager.captureCurrentState.mock.invocationCallOrder[0]);
    });

    test('closeTab flushes pending saves before touching tab state', async () => {
        await controller.closeTab('tab-2');

        expect(flushPendingSaves).toHaveBeenCalledTimes(1);
        expect(flushPendingSaves.mock.invocationCallOrder[0])
            .toBeLessThan(service.getAllTabs.mock.invocationCallOrder[0]);
    });
});
