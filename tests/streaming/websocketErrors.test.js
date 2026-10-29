/* global window */
jest.mock('../../src/modules/responseView.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn(),
    clearResponseDisplayForTab: jest.fn()
}));
jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(),
    updateResponseTime: jest.fn(),
    updateResponseSize: jest.fn()
}));
jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn() }
}));
jest.mock('../../src/modules/tlsOptions.js', () => ({ resolveTlsOptions: jest.fn() }));
jest.mock('../../src/modules/state/settingsCache.js', () => ({ resolveRequestSettings: jest.fn() }));
jest.mock('../../src/modules/requestBodyHelper.js', () => ({ getRequestBodyContent: jest.fn() }));

import { app } from '../../src/modules/appContext.js';
import { clearResponseDisplayForTab, displayResponseWithLineNumbersForTab } from '../../src/modules/responseView.js';
import { updateStatusDisplay } from '../../src/modules/statusDisplay.js';
import { resolveTlsOptions } from '../../src/modules/tlsOptions.js';
import { resolveRequestSettings } from '../../src/modules/state/settingsCache.js';
import { getRequestBodyContent } from '../../src/modules/requestBodyHelper.js';
import { toast } from '../../src/modules/ui/Toast.js';
import {
    handleWebSocketConnect, handleWebSocketSend, handleWebSocketCancel,
    clearWebSocketState, clearWebSocketTranscript, getWebSocketState, isWebSocketLive
} from '../../src/modules/websocketHandler.js';

const url = 'wss://example.test/socket';
const message = 'Failed to connect: failed to look up address information';
let onEvent;
let connection;
let pending;

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    pending.push(resolve);
    return { promise, resolve };
}

const emit = (eventType, extra = {}) => onEvent({
    payload: { tabId: 'tab-1', url, connectionId: connection.connectionId, eventType, ...extra }
});

async function connect(overrides = {}) {
    await handleWebSocketConnect({ tabId: 'tab-1', url, ...overrides });
    return connection;
}

async function transcript() {
    await jest.advanceTimersByTimeAsync(100);
    return displayResponseWithLineNumbersForTab.mock.calls.at(-1)?.[0] || '';
}

describe('WebSocket connection lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        pending = [];
        connection = null;
        resolveTlsOptions.mockResolvedValue({ verifySsl: true });
        resolveRequestSettings.mockResolvedValue({ timeout: 30000 });
        getRequestBodyContent.mockReturnValue('existing composer content');
        app.workspaceTabController = {
            service: {
                getActiveTabId: jest.fn().mockResolvedValue('tab-1'),
                updateTab: jest.fn().mockResolvedValue(undefined)
            }
        };
        window.__TAURI_INTERNALS__ = {
            invoke: jest.fn().mockResolvedValue(undefined),
            transformCallback: (handler) => {
                onEvent = handler;
                return handler;
            }
        };
        window.backendAPI = {
            websocket: {
                connect: jest.fn().mockImplementation(async (request) => {
                    connection = request;
                    return { success: true };
                }),
                send: jest.fn().mockResolvedValue({ success: true }),
                close: jest.fn().mockResolvedValue({ success: true })
            }
        };
    });

    afterEach(async () => {
        pending.forEach(resolve => resolve({ url, headers: {} }));
        await clearWebSocketState('tab-1');
        await clearWebSocketState('tab-2');
        jest.useRealTimers();
        delete window.__TAURI_INTERNALS__;
        delete window.backendAPI;
        app.workspaceTabController = null;
    });

    test('Connect opens a connection without reading or transmitting the message composer', async () => {
        await connect({ headers: { Authorization: 'Bearer token' } });

        expect(window.backendAPI.websocket.connect).toHaveBeenCalledWith({
            tabId: 'tab-1', url, connectionId: expect.any(String),
            headers: { Authorization: 'Bearer token' }, verifySsl: true, connectTimeoutMs: 30000
        });
        expect(getRequestBodyContent).not.toHaveBeenCalled();
        expect(window.backendAPI.websocket.send).not.toHaveBeenCalled();
        expect(getWebSocketState('tab-1')).toBe('connecting');
    });

    test('Send refuses a disconnected tab without connecting implicitly', async () => {
        await handleWebSocketSend('hello', 'tab-1');

        expect(window.backendAPI.websocket.connect).not.toHaveBeenCalled();
        expect(window.backendAPI.websocket.send).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(isWebSocketLive('tab-1')).toBe(false);
    });

    test('Send refuses a connecting tab', async () => {
        await connect();
        await handleWebSocketSend('hello', 'tab-1');

        expect(window.backendAPI.websocket.send).not.toHaveBeenCalled();
    });

    test.each(['hello', ''])('Send transmits one exact text message, including empty text: %j', async (body) => {
        await connect();
        await emit('open');
        await handleWebSocketSend(body, 'tab-1');

        expect(window.backendAPI.websocket.send).toHaveBeenCalledTimes(1);
        expect(window.backendAPI.websocket.send).toHaveBeenCalledWith({
            tabId: 'tab-1', connectionId: connection.connectionId, message: body
        });
        expect((await transcript()).match(/SENT/g)).toHaveLength(1);
        expect(getWebSocketState('tab-1')).toBe('open');
    });

    test('offered sub-protocols reach Connect and the server choice is shown in the transcript', async () => {
        await connect({ protocols: ['chat', '', 'superchat'] });

        expect(connection.protocols).toEqual(['chat', 'superchat']);
        await emit('open', { protocol: 'superchat' });
        expect(await transcript()).toContain(`CONNECTED ${url} [superchat]`);
    });

    test('a prepared request can resolve the protocol list', async () => {
        await connect({ prepare: async () => ({ url, headers: {}, protocols: ['graphql-transport-ws'] }) });

        expect(connection.protocols).toEqual(['graphql-transport-ws']);
    });

    test('an open event without a protocol keeps the plain CONNECTED line', async () => {
        await connect();
        await emit('open');

        const text = await transcript();
        expect(text).toContain(`CONNECTED ${url}`);
        expect(text).not.toMatch(/CONNECTED \S+ \[/);
    });

    test('the existing no-timeout choice reaches Connect as no handshake deadline', async () => {
        resolveRequestSettings.mockResolvedValueOnce({ timeout: null });
        await connect();

        expect(connection.connectTimeoutMs).toBeNull();
    });

    test('new messages appear above earlier messages', async () => {
        await connect();
        await emit('open');
        await emit('message', { message: 'older message' });
        await emit('message', { message: 'newer message' });
        const text = await transcript();
        expect(text.indexOf('newer message')).toBeLessThan(text.indexOf('older message'));
        expect(text.indexOf('older message')).toBeLessThan(text.indexOf('CONNECTED'));
    });

    test('Clear removes the transcript without disconnecting and the next message starts fresh', async () => {
        await connect();
        await emit('open');
        await emit('message', { message: 'old message' });
        await clearWebSocketTranscript('tab-1');
        expect(displayResponseWithLineNumbersForTab).toHaveBeenLastCalledWith('', 'text/plain', 'tab-1');
        expect(app.workspaceTabController.service.updateTab).toHaveBeenLastCalledWith('tab-1', {
            response: expect.objectContaining({ data: '', websocket: { url, state: 'open' } })
        });
        expect(getWebSocketState('tab-1')).toBe('open');
        expect(window.backendAPI.websocket.close).not.toHaveBeenCalled();
        await emit('message', { message: 'fresh message' });
        expect(await transcript()).toContain('fresh message');
        expect(await transcript()).not.toContain('old message');
        expect(await transcript()).not.toContain('CONNECTED');
    });

    test('Clear also empties a restored transcript without a live session', async () => {
        await clearWebSocketTranscript('tab-2');
        expect(clearResponseDisplayForTab).toHaveBeenCalledWith('tab-2');
        expect(app.workspaceTabController.service.updateTab).toHaveBeenCalledWith('tab-2', { response: null });
        expect(window.backendAPI.websocket.close).not.toHaveBeenCalled();
    });

    test('a message preparation failure preserves the connection and does not hide a later transport error', async () => {
        await connect();
        await emit('open');
        await handleWebSocketSend('hello', 'tab-1', async () => { throw new Error('Bad variable'); });
        expect(window.backendAPI.websocket.send).not.toHaveBeenCalled();
        expect(getWebSocketState('tab-1')).toBe('open');
        await emit('error', { message: 'Connection lost' });
        await emit('close', { code: 1006 });
        expect(toast.error).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenLastCalledWith('WebSocket error: Connection lost');
        expect(getWebSocketState('tab-1')).toBe('closed');
    });

    test('disconnecting while preparing a message prevents its transmission', async () => {
        await connect();
        await emit('open');
        const gate = deferred();
        const sending = handleWebSocketSend('hello', 'tab-1', () => gate.promise);
        await handleWebSocketCancel('tab-1');
        gate.resolve('prepared');
        await sending;
        expect(window.backendAPI.websocket.send).not.toHaveBeenCalled();
        expect(window.backendAPI.websocket.close).toHaveBeenCalledTimes(1);
    });

    test('an asynchronous handshake failure produces one toast and a transcript error', async () => {
        await connect();
        await emit('error', { message });

        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith(`WebSocket error: ${message}`);
        expect(updateStatusDisplay).not.toHaveBeenCalledWith(expect.stringContaining(message), null);
        expect(await transcript()).toContain(message);
        expect(isWebSocketLive('tab-1')).toBe(false);
    });

    test.each([message, new Error(message)])('command rejection preserves the real error text: %s', async (error) => {
        window.backendAPI.websocket.connect.mockRejectedValueOnce(error);
        await connect();

        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith(`WebSocket error: ${message}`);
        expect(await transcript()).not.toContain('undefined');
        expect(isWebSocketLive('tab-1')).toBe(false);
    });

    test('repeating the same failed connection records one error per attempt and preserves the transcript', async () => {
        await connect();
        const firstId = connection.connectionId;
        await emit('error', { message });
        await connect();
        await emit('error', { message });

        expect(connection.connectionId).not.toBe(firstId);
        expect(toast.error).toHaveBeenCalledTimes(2);
        expect((await transcript()).match(/ERROR/g)).toHaveLength(2);
        expect(clearResponseDisplayForTab).toHaveBeenCalledTimes(1);
    });

    test('Cancel during request preparation prevents the backend connection', async () => {
        const gate = deferred();
        const connecting = handleWebSocketConnect({ tabId: 'tab-1', url, prepare: () => gate.promise });
        expect(getWebSocketState('tab-1')).toBe('connecting');
        const cancellation = handleWebSocketCancel('tab-1');
        gate.resolve({ url, headers: {} });
        await Promise.all([connecting, cancellation]);

        expect(window.backendAPI.websocket.connect).not.toHaveBeenCalled();
        expect(window.backendAPI.websocket.send).not.toHaveBeenCalled();
        expect(isWebSocketLive('tab-1')).toBe(false);
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('Cancel during TLS preparation prevents the backend connection', async () => {
        const gate = deferred();
        resolveTlsOptions.mockReturnValueOnce(gate.promise);
        const connecting = handleWebSocketConnect({ tabId: 'tab-1', url });
        await Promise.resolve();
        const cancellation = handleWebSocketCancel('tab-1');
        gate.resolve({ verifySsl: true });
        await Promise.all([connecting, cancellation]);

        expect(window.backendAPI.websocket.connect).not.toHaveBeenCalled();
        expect(isWebSocketLive('tab-1')).toBe(false);
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('Cancel during command registration closes that connection once acknowledged and ignores a late open', async () => {
        const gate = deferred();
        const entered = deferred();
        window.backendAPI.websocket.connect.mockImplementationOnce((request) => {
            connection = request;
            entered.resolve();
            return gate.promise;
        });
        const connecting = handleWebSocketConnect({ tabId: 'tab-1', url });
        await entered.promise;
        const cancelledId = connection.connectionId;
        const cancellation = handleWebSocketCancel('tab-1');
        await emit('open');
        gate.resolve({ success: true });
        await Promise.all([connecting, cancellation]);
        await emit('cancelled');

        expect(window.backendAPI.websocket.close).toHaveBeenCalledWith('tab-1', cancelledId);
        expect(getWebSocketState('tab-1')).toBe('closed');
        expect(await transcript()).not.toContain('CONNECTED');
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('events from a previous attempt cannot reopen or modify its successor at the same URL', async () => {
        await connect();
        const oldId = connection.connectionId;
        await emit('error', { message });
        await connect();
        jest.clearAllMocks();

        for (const eventType of ['open', 'message', 'error', 'close']) {
            await emit(eventType, { connectionId: oldId, message: 'stale', code: 1000 });
        }

        expect(getWebSocketState('tab-1')).toBe('connecting');
        expect(updateStatusDisplay).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('closing a tab during command registration removes its session immediately and closes the backend later', async () => {
        const gate = deferred();
        const entered = deferred();
        window.backendAPI.websocket.connect.mockImplementationOnce((request) => {
            connection = request;
            entered.resolve();
            return gate.promise;
        });
        const connecting = handleWebSocketConnect({ tabId: 'tab-1', url });
        await entered.promise;
        const closing = clearWebSocketState('tab-1');
        expect(getWebSocketState('tab-1')).toBe('closed');
        jest.clearAllMocks();
        await emit('open');
        gate.resolve({ success: true });
        await Promise.all([connecting, closing]);

        expect(window.backendAPI.websocket.close).toHaveBeenCalledWith('tab-1', connection.connectionId);
        expect(displayResponseWithLineNumbersForTab).not.toHaveBeenCalled();
        expect(updateStatusDisplay).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('a connection stays attached to its originating tab after switching active tabs', async () => {
        const gate = deferred();
        resolveTlsOptions.mockReturnValueOnce(gate.promise);
        const connecting = handleWebSocketConnect({ tabId: 'tab-1', url });
        app.workspaceTabController.service.getActiveTabId.mockResolvedValue('tab-2');
        gate.resolve({ verifySsl: true });
        await connecting;
        updateStatusDisplay.mockClear();
        await emit('open');

        expect(connection.tabId).toBe('tab-1');
        expect(getWebSocketState('tab-1')).toBe('open');
        expect(getWebSocketState('tab-2')).toBe('closed');
        expect(updateStatusDisplay).not.toHaveBeenCalled();
    });

    test.each([1005, 1006, 4001])('preserves the reported close code %i and reason', async (code) => {
        await connect();
        await emit('open');
        await emit('close', { code, reason: 'Server reason' });

        expect(updateStatusDisplay).toHaveBeenLastCalledWith(`WebSocket closed (${code})`, null);
        expect(await transcript()).toContain(`CLOSED ${code} Server reason`);
        expect(isWebSocketLive('tab-1')).toBe(false);
    });
});
