/* global window */
jest.mock('../../src/modules/apiHandler.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn(),
    clearResponseDisplayForTab: jest.fn()
}));

jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(),
    updateResponseTime: jest.fn(),
    updateResponseSize: jest.fn()
}));

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

jest.mock('../../src/modules/tlsOptions.js', () => ({
    resolveTlsOptions: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/modules/requestBodyHelper.js', () => ({
    getRequestBodyContent: jest.fn(() => '')
}));

import { displayResponseWithLineNumbersForTab } from '../../src/modules/apiHandler.js';
import { updateStatusDisplay } from '../../src/modules/statusDisplay.js';
import { app } from '../../src/modules/appContext.js';
import { initWebSocketHandler, handleWebSocketSend } from '../../src/modules/websocketHandler.js';
import { initMqttHandler } from '../../src/modules/mqttHandler.js';

/**
 * A closed tab drops its stream session while the backend is still unwinding,
 * so its terminal event arrives afterwards. Acting on it rebuilds the tab's
 * response container — the tab visibly comes back from the dead. SSE and the
 * GraphQL subscription handler already ignore sessionless events; WebSocket and
 * MQTT did not.
 */
describe('streaming handlers ignore events for tabs with no session', () => {
    const handlers = {};

    /**
     * The listener bootstrap memoizes its registration, so it can only be
     * captured once per module instance.
     */
    beforeAll(async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: jest.fn(async (command, args) => {
                if (command === 'plugin:event|listen') {
                    handlers[args.event] = args.handler;
                }
            }),
            transformCallback: (fn) => fn
        };

        window.backendAPI = {
            websocket: { send: jest.fn().mockResolvedValue(undefined) },
            mqtt: { connect: jest.fn().mockResolvedValue(undefined) }
        };

        await initWebSocketHandler();
        await initMqttHandler();
    });

    afterAll(() => {
        delete window.__TAURI_INTERNALS__;
        delete window.backendAPI;
        app.workspaceTabController = null;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        app.workspaceTabController = {
            service: { getActiveTabId: jest.fn().mockResolvedValue('tab-1') }
        };
    });

    test('a websocket close for an unknown tab renders nothing', async () => {
        await handlers['websocket-event']({
            payload: { tabId: 'gone', eventType: 'close', code: 1000 }
        });

        expect(displayResponseWithLineNumbersForTab).not.toHaveBeenCalled();
        expect(updateStatusDisplay).not.toHaveBeenCalled();
    });

    test('a websocket error for an unknown tab renders nothing', async () => {
        await handlers['websocket-event']({
            payload: { tabId: 'gone', eventType: 'error', message: 'boom' }
        });

        expect(displayResponseWithLineNumbersForTab).not.toHaveBeenCalled();
        expect(updateStatusDisplay).not.toHaveBeenCalled();
    });

    test('an mqtt disconnect for an unknown tab renders nothing', async () => {
        await handlers['mqtt-event']({
            payload: { tabId: 'gone', eventType: 'disconnect' }
        });

        expect(displayResponseWithLineNumbersForTab).not.toHaveBeenCalled();
        expect(updateStatusDisplay).not.toHaveBeenCalled();
    });

    test('a live websocket tab still renders its open and message events', async () => {
        await handleWebSocketSend('wss://example.test/socket');

        jest.clearAllMocks();

        await handlers['websocket-event']({
            payload: { tabId: 'tab-1', eventType: 'open', url: 'wss://example.test/socket' }
        });
        await handlers['websocket-event']({
            payload: { tabId: 'tab-1', eventType: 'message', message: 'hello' }
        });

        expect(updateStatusDisplay).toHaveBeenCalledWith('WebSocket connected', 101);
        expect(displayResponseWithLineNumbersForTab).toHaveBeenCalled();
        const rendered = displayResponseWithLineNumbersForTab.mock.calls.at(-1)[0];
        expect(rendered).toContain('RECEIVED');
        expect(rendered).toContain('hello');
    });
});
