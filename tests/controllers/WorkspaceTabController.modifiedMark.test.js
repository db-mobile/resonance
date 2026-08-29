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

describe('WorkspaceTabController modified marking', () => {
    let controller;
    let service;
    let stateManager;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        service = {
            addListener: jest.fn(),
            getActiveTabId: jest.fn().mockResolvedValue('tab-A'),
            setTabModified: jest.fn().mockResolvedValue(undefined),
            updateTab: jest.fn().mockResolvedValue(undefined)
        };
        stateManager = {
            captureCurrentState: jest.fn().mockResolvedValue({ url: 'captured' })
        };
        controller = new WorkspaceTabController(
            service,
            { render: jest.fn(), setActiveTab: jest.fn(), updateTab: jest.fn() },
            stateManager,
            { showContainer: jest.fn(), removeContainer: jest.fn() }
        );
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('repeated calls persist the modified flag only once', async () => {
        for (let i = 0; i < 5; i++) {
            await controller.markCurrentTabModified();
        }

        expect(service.setTabModified).toHaveBeenCalledTimes(1);
        expect(service.setTabModified).toHaveBeenCalledWith('tab-A', true);
    });

    test('markCurrentTabUnmodified re-arms the modified flag write', async () => {
        await controller.markCurrentTabModified();
        await controller.markCurrentTabUnmodified();
        await controller.markCurrentTabModified();

        expect(service.setTabModified).toHaveBeenCalledTimes(3);
        expect(service.setTabModified).toHaveBeenNthCalledWith(2, 'tab-A', false);
        expect(service.setTabModified).toHaveBeenNthCalledWith(3, 'tab-A', true);
    });

    test('the debounced persist fires once with the schedule-time tab id', async () => {
        await controller.markCurrentTabModified();
        await controller.markCurrentTabModified();

        service.getActiveTabId.mockResolvedValue('tab-B');
        await jest.advanceTimersByTimeAsync(1500);

        expect(stateManager.captureCurrentState).toHaveBeenCalledTimes(1);
        expect(service.updateTab).toHaveBeenCalledTimes(1);
        expect(service.updateTab).toHaveBeenCalledWith('tab-A', { url: 'captured' });
    });

    test('the debounced persist skips while a restore is in progress', async () => {
        await controller.markCurrentTabModified();

        controller.isRestoringState = true;
        await jest.advanceTimersByTimeAsync(1500);

        expect(stateManager.captureCurrentState).not.toHaveBeenCalled();
        expect(service.updateTab).not.toHaveBeenCalled();
    });
});
