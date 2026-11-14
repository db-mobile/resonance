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
            getActiveTabId: jest.fn().mockResolvedValue('tab-A'),
            getAllTabs: jest.fn().mockResolvedValue([
                { id: 'tab-A', type: 'http' },
                { id: 'tab-B', type: 'http' },
                { id: 'tab-C', type: 'http' }
            ]),
            switchTab: jest.fn(async (id) => ({ id, type: 'http' })),
            closeTab: jest.fn(),
            closeTabs: jest.fn(),
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
        service.closeTabs.mockResolvedValue({ newActiveTabId: 'tab-A' });

        await controller.closeOtherTabs('tab-A');

        expect(stateManager.restoreTabState).not.toHaveBeenCalled();
    });

    test('closeOtherTabs keeping a background tab activates it', async () => {
        service.closeTabs.mockResolvedValue({ newActiveTabId: 'tab-B' });
        const allTabs = [
            { id: 'tab-A', type: 'http' },
            { id: 'tab-B', type: 'http' },
            { id: 'tab-C', type: 'http' }
        ];
        service.getAllTabs
            .mockResolvedValueOnce(allTabs)
            .mockResolvedValueOnce(allTabs)
            .mockResolvedValue([{ id: 'tab-B', type: 'http' }]);

        await controller.closeOtherTabs('tab-B');

        expect(service.closeTabs).toHaveBeenCalledWith(['tab-A', 'tab-C']);

        expect(stateManager.restoreTabState).toHaveBeenCalledTimes(1);
        expect(stateManager.restoreTabState).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'tab-B' })
        );
    });
});

describe('WorkspaceTabController binds the scripts editor to every tab it activates', () => {
    let controller;
    let service;
    let scriptController;
    const graphqlTab = { id: 'tab-G', type: 'graphql', endpoint: { collectionId: 'c1', endpointId: 'gql', protocol: 'graphql' } };

    beforeEach(async () => {
        jest.clearAllMocks();
        const { app } = await import('../../src/modules/appContext.js');
        scriptController = {
            isShowingScriptsFor: jest.fn().mockReturnValue(false),
            loadScriptsForEndpoint: jest.fn().mockResolvedValue(undefined),
            clearScripts: jest.fn().mockResolvedValue(undefined)
        };
        app.scriptController = scriptController;
        service = {
            initialize: jest.fn().mockResolvedValue({ tabs: [graphqlTab], activeTabId: 'tab-G' }),
            getActiveTabId: jest.fn().mockResolvedValue('tab-A'),
            getAllTabs: jest.fn().mockResolvedValue([{ id: 'tab-A', type: 'http' }, graphqlTab]),
            closeTab: jest.fn().mockResolvedValue({ newActiveTabId: 'tab-G' }),
            updateTab: jest.fn().mockResolvedValue(undefined)
        };
        controller = new WorkspaceTabController(
            service,
            { render: jest.fn(), setActiveTab: jest.fn(), updateTab: jest.fn() },
            { captureCurrentState: jest.fn().mockResolvedValue({ endpoint: null }), restoreTabState: jest.fn() },
            { showContainer: jest.fn(), removeContainer: jest.fn() }
        );
    });

    afterEach(async () => {
        const { app } = await import('../../src/modules/appContext.js');
        delete app.scriptController;
    });

    test('closing a tab loads the scripts of the GraphQL tab that becomes active', async () => {
        await controller.closeTab('tab-A');

        expect(scriptController.loadScriptsForEndpoint).toHaveBeenCalledWith('c1', 'gql');
    });

    test('initializing with a GraphQL tab active loads its scripts', async () => {
        await controller.initialize();

        expect(scriptController.loadScriptsForEndpoint).toHaveBeenCalledWith('c1', 'gql');
    });
});
