/* global document */
/** @fileoverview Pins that switching back to a tab reuses its already-rendered response panes. */

const statusCalls = { status: jest.fn(), time: jest.fn(), size: jest.fn() };
let displayResponse;
let clearResponse;

async function loadHarness() {
    jest.resetModules();
    Object.values(statusCalls).forEach(fn => fn.mockClear());
    displayResponse = jest.fn();
    clearResponse = jest.fn();

    jest.doMock('../src/modules/responseView.js', () => ({
        displayResponseWithLineNumbersForTab: displayResponse,
        clearResponseDisplayForTab: clearResponse,
        clearSchemaValidationBadge: jest.fn(),
        clearGraphQLErrorsBadge: jest.fn()
    }));
    const authManagerStub = { getAuthConfig: jest.fn(() => ({})), loadAuthConfig: jest.fn() };
    jest.doMock('../src/modules/mqttHandler.js', () => ({ refreshMqttConnectionUi: jest.fn() }));
    jest.doMock('../src/modules/statusDisplay.js', () => ({
        updateStatusDisplay: statusCalls.status,
        updateResponseTime: statusCalls.time,
        updateResponseSize: statusCalls.size
    }));

    const { WorkspaceTabStateManager } = await import('../src/modules/WorkspaceTabStateManager.js');
    const { app } = await import('../src/modules/appContext.js');

    const container = {
        clearBtn: document.createElement('button'),
        headersEditor: { setContent: jest.fn() },
        cookiesDisplay: document.createElement('div'),
        performanceDisplay: null,
        renderedResponse: null
    };
    app.responseContainerManager = { getOrCreateContainer: jest.fn(() => container) };

    const manager = new WorkspaceTabStateManager({ authManager: authManagerStub });
    return { manager, container };
}

function responseOf(data) {
    return { data, headers: { 'content-type': 'application/json' }, status: 200, statusText: 'OK', ttfb: 12, size: 34 };
}

describe('_restoreResponse', () => {
    test('WebSocket response Clear remains available after restoring a disconnected tab', async () => {
        const { manager, container } = await loadHarness();
        container.clearBtn.classList.add('is-hidden');
        await manager._restoreResponseState({ id: 'tab-1', request: { protocol: 'websocket' }, response: null });
        expect(container.clearBtn.classList.contains('is-hidden')).toBe(false);
    });

    test('the WebSocket Clear control stays hidden for other protocols', async () => {
        const { manager, container } = await loadHarness();
        await manager._restoreResponseState({ id: 'tab-1', request: { protocol: 'http' }, response: null });
        expect(container.clearBtn.classList.contains('is-hidden')).toBe(true);
    });
    test('restores unary gRPC inspection state and its typed completed source', async () => {
        const { manager, container } = await loadHarness();
        container.inspection = { restore: jest.fn(), setSource: jest.fn() };
        const state = { view: 'results', json: { draft: '$.count', applied: '$.count' } };
        await manager._restoreGrpc({ id: 'tab-1', request: { grpc: {} }, responseInspection: state,
            response: { data: { count: 0 }, isJson: true, grpc: { ok: true }, headers: {} } });
        expect(container.inspection.restore).toHaveBeenCalledWith(state);
        expect(container.inspection.setSource).toHaveBeenCalledWith({ format: 'json', body: '{"count":0}' });
    });

    test.each([
        [false, 'false', 'json'],
        [0, '0', 'json'],
        [null, 'null', 'json'],
        ['', '', undefined]
    ])('restores the saved JSON scalar %p as a completed response', async (data, displayed, languageHint) => {
        const { manager } = await loadHarness();

        await manager._restoreResponse({ ...responseOf(data), isJson: true }, 'tab-1');

        expect(displayResponse).toHaveBeenCalledWith(displayed, 'application/json', 'tab-1', languageHint);
        expect(clearResponse).not.toHaveBeenCalled();
    });

    test('clears the response pane when the saved response has no body property', async () => {
        const { manager } = await loadHarness();
        const response = responseOf(undefined);
        delete response.data;

        await manager._restoreResponse(response, 'tab-1');

        expect(displayResponse).not.toHaveBeenCalled();
        expect(clearResponse).toHaveBeenCalledWith('tab-1');
    });

    test('clears the response pane for a never-sent tab placeholder', async () => {
        const { manager } = await loadHarness();
        const placeholder = { data: null, headers: {}, status: null, statusText: '', ttfb: null, size: null, timings: null, cookies: [] };

        await manager._restoreResponse(placeholder, 'tab-1');

        expect(displayResponse).not.toHaveBeenCalled();
        expect(clearResponse).toHaveBeenCalledWith('tab-1');
    });

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
