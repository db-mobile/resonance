import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';
import { clearWebSocketState } from '../../src/modules/websocketHandler.js';
import { clearSseState } from '../../src/modules/sseHandler.js';
import { clearMqttState } from '../../src/modules/mqttHandler.js';
import { clearStreamState } from '../../src/modules/grpcStreamHandler.js';
import { clearGraphQLSubscriptionState } from '../../src/modules/graphqlSubscriptionHandler.js';

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

describe('WorkspaceTabController tab-close teardown', () => {
    let controller;
    let responseContainerManager;

    beforeEach(() => {
        jest.clearAllMocks();
        const service = { addListener: jest.fn() };
        const tabBar = {};
        const stateManager = {};
        responseContainerManager = { removeContainer: jest.fn() };
        controller = new WorkspaceTabController(service, tabBar, stateManager, responseContainerManager);
    });

    test('closing a tab tears down every streaming protocol for that tab', () => {
        controller._cleanupClosedTabUI('tab-42');

        expect(clearWebSocketState).toHaveBeenCalledWith('tab-42');
        expect(clearSseState).toHaveBeenCalledWith('tab-42');
        expect(clearMqttState).toHaveBeenCalledWith('tab-42');
        expect(clearStreamState).toHaveBeenCalledWith('tab-42');
        expect(clearGraphQLSubscriptionState).toHaveBeenCalledWith('tab-42');
        expect(responseContainerManager.removeContainer).toHaveBeenCalledWith('tab-42');
    });

    test('teardown is skipped when no tabId is provided', () => {
        controller._teardownTabConnections(undefined);

        expect(clearWebSocketState).not.toHaveBeenCalled();
        expect(clearSseState).not.toHaveBeenCalled();
        expect(clearMqttState).not.toHaveBeenCalled();
        expect(clearStreamState).not.toHaveBeenCalled();
        expect(clearGraphQLSubscriptionState).not.toHaveBeenCalled();
    });

    test('a failing protocol clearer does not abort teardown of the others', () => {
        clearWebSocketState.mockRejectedValueOnce(new Error('backend unavailable'));

        expect(() => controller._cleanupClosedTabUI('tab-7')).not.toThrow();

        expect(clearSseState).toHaveBeenCalledWith('tab-7');
        expect(clearMqttState).toHaveBeenCalledWith('tab-7');
        expect(clearStreamState).toHaveBeenCalledWith('tab-7');
        expect(clearGraphQLSubscriptionState).toHaveBeenCalledWith('tab-7');
    });
});
