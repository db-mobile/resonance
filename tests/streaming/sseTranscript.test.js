/* global window */
jest.mock('../../src/modules/responseView.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn(), clearResponseDisplayForTab: jest.fn()
}));
jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(), updateResponseTime: jest.fn(), updateResponseSize: jest.fn()
}));
jest.mock('../../src/modules/tlsOptions.js', () => ({ resolveTlsOptions: jest.fn().mockResolvedValue({}) }));

import { app } from '../../src/modules/appContext.js';
import { displayResponseWithLineNumbersForTab, clearResponseDisplayForTab } from '../../src/modules/responseView.js';
import { handleSseConnect, clearSseState, clearSseTranscript, isSseLive } from '../../src/modules/sseHandler.js';

describe('SSE transcript order', () => {
    const url = 'https://example.test/events';
    let onEvent;
    const lastConnect = () => window.backendAPI.sse.connect.mock.calls.at(-1)[0];
    const emit = (eventType, extra = {}) => onEvent({
        payload: { tabId: 'tab-1', url, connectionId: lastConnect().connectionId, eventType, ...extra }
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        app.workspaceTabController = { service: {
            getActiveTabId: jest.fn().mockResolvedValue('tab-1'),
            updateTab: jest.fn().mockResolvedValue(undefined)
        } };
        window.__TAURI_INTERNALS__ = {
            invoke: jest.fn().mockResolvedValue(undefined),
            transformCallback: handler => { onEvent = handler; return handler; }
        };
        window.backendAPI = { sse: {
            connect: jest.fn().mockResolvedValue({ success: true }),
            close: jest.fn().mockResolvedValue({ success: true })
        } };
    });

    afterEach(async () => {
        await clearSseState('tab-1');
        jest.useRealTimers();
        delete window.backendAPI;
        delete window.__TAURI_INTERNALS__;
        delete app.workspaceTabController;
    });

    test('prepends complete messages and saves the same order while preserving reconnect IDs', async () => {
        await handleSseConnect(url);
        await emit('open');
        await emit('message', { event: 'update', id: '1', data: 'older\n\nmessage' });
        await emit('message', { event: 'update', id: '2', data: 'newer\nmessage' });
        await jest.advanceTimersByTimeAsync(500);

        const transcript = displayResponseWithLineNumbersForTab.mock.calls.at(-1)[0];
        expect(transcript).toMatch(/^\[[^\]]+\] EVENT\nevent: update\nid: 2\nnewer\nmessage/);
        expect(transcript).toContain('event: update\nid: 1\nolder\n\nmessage');
        expect(transcript.indexOf('newer')).toBeLessThan(transcript.indexOf('older'));
        expect(transcript.indexOf('older')).toBeLessThan(transcript.indexOf('CONNECTED'));
        expect(app.workspaceTabController.service.updateTab).toHaveBeenLastCalledWith('tab-1', {
            response: expect.objectContaining({ data: transcript, sse: { url, state: 'open' } })
        });
        expect(isSseLive('tab-1')).toBe(true);
        await handleSseConnect(url);
        expect(window.backendAPI.sse.connect).toHaveBeenLastCalledWith(expect.objectContaining({ lastEventId: '2' }));
    });

    test('Clear empties live messages and persistence, preserves the stream and reconnect ID, and accepts new events', async () => {
        await handleSseConnect(url);
        await emit('open');
        await emit('message', { id: 'keep-id', data: 'old message' });
        await clearSseTranscript('tab-1');
        expect(displayResponseWithLineNumbersForTab).toHaveBeenLastCalledWith('', 'text/plain', 'tab-1');
        expect(app.workspaceTabController.service.updateTab).toHaveBeenLastCalledWith('tab-1', {
            response: expect.objectContaining({ data: '', sse: { url, state: 'open' } })
        });
        expect(isSseLive('tab-1')).toBe(true);
        expect(window.backendAPI.sse.close).not.toHaveBeenCalled();
        await handleSseConnect(url);
        expect(window.backendAPI.sse.connect).toHaveBeenLastCalledWith(expect.objectContaining({ lastEventId: 'keep-id' }));
        await emit('message', { data: 'new message' });
        await jest.advanceTimersByTimeAsync(500);
        const transcript = displayResponseWithLineNumbersForTab.mock.calls.at(-1)[0];
        expect(transcript).toContain('new message');
        expect(transcript).not.toContain('old message');
        expect(transcript).not.toContain('CONNECTED');
    });

    test('events from the stream a reconnect replaced are ignored', async () => {
        await handleSseConnect(url);
        const replaced = lastConnect().connectionId;
        await emit('open');
        await handleSseConnect(url);
        expect(lastConnect().connectionId).not.toBe(replaced);

        await emit('message', { connectionId: replaced, id: 'stale', data: 'from the old stream' });
        await emit('message', { connectionId: undefined, data: 'unlabelled' });
        await emit('message', { id: 'fresh', data: 'from the new stream' });
        await jest.advanceTimersByTimeAsync(500);

        const transcript = displayResponseWithLineNumbersForTab.mock.calls.at(-1)[0];
        expect(transcript).toContain('from the new stream');
        expect(transcript).not.toContain('from the old stream');
        expect(transcript).not.toContain('unlabelled');
        await handleSseConnect(url);
        expect(lastConnect().lastEventId).toBe('fresh');
    });

    test('an empty event id resets the reconnect ID', async () => {
        await handleSseConnect(url);
        await emit('open');
        await emit('message', { id: '7', data: 'one' });
        await emit('message', { id: '', data: 'two' });
        await handleSseConnect(url);
        expect(lastConnect().lastEventId).toBeNull();
    });

    test('a different URL starts without the previous stream\'s reconnect ID', async () => {
        await handleSseConnect(url);
        await emit('open');
        await emit('message', { id: '7', data: 'one' });
        await handleSseConnect('https://example.test/other');
        expect(lastConnect()).toEqual(expect.objectContaining({
            url: 'https://example.test/other', lastEventId: null
        }));
    });

    test('Clear removes a restored SSE response without creating or closing a connection', async () => {
        await clearSseTranscript('restored-tab');
        expect(clearResponseDisplayForTab).toHaveBeenCalledWith('restored-tab');
        expect(app.workspaceTabController.service.updateTab).toHaveBeenCalledWith('restored-tab', { response: null });
        expect(window.backendAPI.sse.close).not.toHaveBeenCalled();
        expect(window.backendAPI.sse.connect).not.toHaveBeenCalled();
    });
});
