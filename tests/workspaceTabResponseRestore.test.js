/* global document */
/** @fileoverview Pins that switching back to a tab reuses its already-rendered response panes. */

const statusCalls = { status: jest.fn(), time: jest.fn(), size: jest.fn() };
let displayResponse;

async function loadHarness() {
    jest.resetModules();
    Object.values(statusCalls).forEach(fn => fn.mockClear());
    displayResponse = jest.fn();

    jest.doMock('../src/modules/apiHandler.js', () => ({
        displayResponseWithLineNumbersForTab: displayResponse,
        clearResponseDisplayForTab: jest.fn(),
        clearSchemaValidationBadge: jest.fn(),
        clearGraphQLErrorsBadge: jest.fn()
    }));
    jest.doMock('../src/modules/authManager.js', () => ({
        authManager: { getAuthConfig: jest.fn(() => ({})), loadAuthConfig: jest.fn() }
    }));
    jest.doMock('../src/modules/mqttHandler.js', () => ({ refreshMqttConnectionUi: jest.fn() }));
    jest.doMock('../src/modules/statusDisplay.js', () => ({
        updateStatusDisplay: statusCalls.status,
        updateResponseTime: statusCalls.time,
        updateResponseSize: statusCalls.size
    }));

    const { WorkspaceTabStateManager } = await import('../src/modules/WorkspaceTabStateManager.js');
    const { app } = await import('../src/modules/appContext.js');

    const container = {
        headersEditor: { setContent: jest.fn() },
        cookiesDisplay: document.createElement('div'),
        performanceDisplay: null,
        renderedResponse: null
    };
    app.responseContainerManager = { getOrCreateContainer: jest.fn(() => container) };

    const manager = new WorkspaceTabStateManager({});
    return { manager, container };
}

function responseOf(data) {
    return { data, headers: { 'content-type': 'application/json' }, status: 200, statusText: 'OK', ttfb: 12, size: 34 };
}

describe('_restoreResponse', () => {
    test('restoring the same response twice renders the panes once', async () => {
        const { manager, container } = await loadHarness();
        const response = responseOf({ a: 1 });

        await manager._restoreResponse(response, 'tab-1');
        await manager._restoreResponse(response, 'tab-1');

        expect(displayResponse).toHaveBeenCalledTimes(1);
        expect(container.headersEditor.setContent).toHaveBeenCalledTimes(1);
    });

    test('the status bar is still updated on every restore', async () => {
        const { manager } = await loadHarness();
        const response = responseOf({ a: 1 });

        await manager._restoreResponse(response, 'tab-1');
        await manager._restoreResponse(response, 'tab-1');

        expect(statusCalls.status).toHaveBeenCalledTimes(2);
        expect(statusCalls.time).toHaveBeenLastCalledWith(12);
        expect(statusCalls.size).toHaveBeenLastCalledWith(34);
    });

    test('a new response object re-renders', async () => {
        const { manager } = await loadHarness();

        await manager._restoreResponse(responseOf({ a: 1 }), 'tab-1');
        await manager._restoreResponse(responseOf({ a: 2 }), 'tab-1');

        expect(displayResponse).toHaveBeenCalledTimes(2);
    });

    test('a pane write in between re-renders', async () => {
        const { manager, container } = await loadHarness();
        const response = responseOf({ a: 1 });

        await manager._restoreResponse(response, 'tab-1');
        container.renderedResponse = null;
        await manager._restoreResponse(response, 'tab-1');

        expect(displayResponse).toHaveBeenCalledTimes(2);
    });
});
