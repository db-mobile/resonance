import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';

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
    WorkspaceTabEndpointLoaderService: jest.fn().mockImplementation(() => ({
        loadEndpoint: jest.fn().mockResolvedValue(undefined),
        loadHistoryEntry: jest.fn().mockResolvedValue(undefined)
    }))
}));

describe('WorkspaceTabController history entries', () => {
    let controller;
    let tabs;

    beforeEach(() => {
        jest.clearAllMocks();

        tabs = [{ id: 'tab-http', request: { protocol: 'http' } }];

        const service = {
            addListener: jest.fn(),
            getAllTabs: jest.fn(() => Promise.resolve(tabs))
        };

        controller = new WorkspaceTabController(service, {}, {}, {});
        controller.createNewTab = jest.fn(() => Promise.resolve({ id: 'tab-new' }));
        controller.switchTab = jest.fn().mockResolvedValue(undefined);
    });

    test('a gRPC entry opens a new tab seeded with the gRPC protocol', async () => {
        const entry = { id: 'history_1', request: { protocol: 'grpc' } };

        await controller.loadHistoryEntry(entry);

        expect(controller.createNewTab).toHaveBeenCalledWith({ protocol: 'grpc' });
        expect(controller.endpointLoader.loadHistoryEntry).toHaveBeenCalledWith(entry, 'tab-new');
        expect(controller.switchTab).not.toHaveBeenCalled();
    });

    test('an entry without a protocol opens an HTTP tab', async () => {
        await controller.loadHistoryEntry({ id: 'history_2', request: {} });

        expect(controller.createNewTab).toHaveBeenCalledWith({ protocol: 'http' });
    });

    test('clicking the same entry again focuses its tab instead of opening another', async () => {
        tabs.push({ id: 'tab-replay', historyEntryId: 'history_1' });

        await controller.loadHistoryEntry({ id: 'history_1', request: { protocol: 'grpc' } });

        expect(controller.switchTab).toHaveBeenCalledWith('tab-replay');
        expect(controller.createNewTab).not.toHaveBeenCalled();
        expect(controller.endpointLoader.loadHistoryEntry).not.toHaveBeenCalled();
    });
});
