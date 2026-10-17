/* global document */

function markup() {
    return `
        <button id="send-request-btn" title="Send request">Send</button>
        <button id="cancel-request-btn" style="display: none;">Cancel</button>
    `;
}

async function loadSendControls({ mode = 'http', activeTabId = 'tab-1' } = {}) {
    document.body.innerHTML = markup();
    jest.resetModules();

    jest.doMock('../../src/modules/streaming/streamSession.js', () => ({ getActiveTabId: jest.fn(async () => activeTabId) }));
    const modeState = { current: mode };
    jest.doMock('../../src/modules/requestModeManager.js', () => ({
        getCurrentMode: () => modeState.current
    }));

    const { registerProtocolHandler } = await import('../../src/modules/protocols/protocolRegistry.js');
    const live = { websocket: jest.fn(() => false), sse: jest.fn(() => false), grpc: jest.fn(() => false), graphql: jest.fn(() => false) };
    for (const id of ['http', 'mqtt']) {
        registerProtocolHandler(id, { send: jest.fn(), cancel: jest.fn(), isLive: () => false });
    }
    for (const id of Object.keys(live)) {
        registerProtocolHandler(id, { send: jest.fn(), cancel: jest.fn(), isLive: live[id] });
    }

    const controls = await import('../../src/modules/sendControls.js');
    const { app } = await import('../../src/modules/appContext.js');
    const { STREAM_STATE_EVENT } = await import('../../src/modules/streaming/streamState.js');
    const setRequestRunning = jest.fn();
    app.statusBar = { setRequestRunning };
    return { ...controls, live, modeState, setRequestRunning, STREAM_STATE_EVENT };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

const sendBtn = () => document.getElementById('send-request-btn');
const cancelBtn = () => document.getElementById('cancel-request-btn');

async function notify(STREAM_STATE_EVENT) {
    document.dispatchEvent(new Event(STREAM_STATE_EVENT));
    await flush();
}

describe('sendControls', () => {
    test('a request in progress swaps Send for a Cancel button', async () => {
        const { setRequestInProgress, setRequestRunning } = await loadSendControls();

        setRequestInProgress(true);

        expect(sendBtn().style.display).toBe('none');
        expect(sendBtn().disabled).toBe(true);
        expect(cancelBtn().style.display).toBe('inline-block');
        expect(cancelBtn().textContent).toBe('Cancel');
        expect(cancelBtn().getAttribute('aria-label')).toBe('Cancel');
        expect(setRequestRunning).toHaveBeenCalledWith(true);
    });

    test('finishing restores Send and hides Cancel when nothing is live', async () => {
        const { setRequestInProgress, setRequestRunning } = await loadSendControls();

        setRequestInProgress(true);
        setRequestInProgress(false);
        await flush();

        expect(sendBtn().style.display).toBe('inline-block');
        expect(sendBtn().disabled).toBe(false);
        expect(cancelBtn().style.display).toBe('none');
        expect(setRequestRunning).toHaveBeenLastCalledWith(false);
    });

    test('a live websocket shows the Cancel button labelled Disconnect', async () => {
        const { live, STREAM_STATE_EVENT } = await loadSendControls({ mode: 'websocket' });
        live.websocket.mockReturnValue(true);

        await notify(STREAM_STATE_EVENT);

        expect(live.websocket).toHaveBeenCalledWith('tab-1');
        expect(cancelBtn().style.display).toBe('inline-block');
        expect(cancelBtn().textContent).toBe('Disconnect');
        expect(cancelBtn().getAttribute('aria-label')).toBe('Disconnect');
        expect(sendBtn().textContent).toBe('Send');
    });

    test('a closed stream hides Cancel and restores the Cancel label', async () => {
        const { live, STREAM_STATE_EVENT } = await loadSendControls({ mode: 'sse' });
        live.sse.mockReturnValue(true);
        await notify(STREAM_STATE_EVENT);
        expect(cancelBtn().textContent).toBe('Disconnect');

        live.sse.mockReturnValue(false);
        await notify(STREAM_STATE_EVENT);

        expect(cancelBtn().style.display).toBe('none');
        expect(cancelBtn().textContent).toBe('Cancel');
    });

    test('HTTP mode never shows the Disconnect button', async () => {
        const { STREAM_STATE_EVENT } = await loadSendControls({ mode: 'http' });

        await notify(STREAM_STATE_EVENT);

        expect(cancelBtn().style.display).toBe('none');
    });

    test('a live GraphQL subscription turns Send into Stop and keeps Cancel hidden', async () => {
        const { live, STREAM_STATE_EVENT } = await loadSendControls({ mode: 'graphql' });
        live.graphql.mockReturnValue(true);

        await notify(STREAM_STATE_EVENT);

        expect(sendBtn().textContent).toBe('Stop');
        expect(sendBtn().title).toBe('Stop subscription');
        expect(cancelBtn().style.display).toBe('none');

        live.graphql.mockReturnValue(false);
        await notify(STREAM_STATE_EVENT);

        expect(sendBtn().textContent).toBe('Send');
        expect(sendBtn().title).toBe('Send request');
    });

    test('switching away from GraphQL restores the Send label', async () => {
        const { live, modeState, STREAM_STATE_EVENT } = await loadSendControls({ mode: 'graphql' });
        live.graphql.mockReturnValue(true);
        await notify(STREAM_STATE_EVENT);
        expect(sendBtn().textContent).toBe('Stop');

        modeState.current = 'http';
        await notify(STREAM_STATE_EVENT);

        expect(sendBtn().textContent).toBe('Send');
        expect(sendBtn().title).toBe('Send request');
    });

    test('stream state events do not touch the buttons while a request is in progress', async () => {
        const { setRequestInProgress, live, STREAM_STATE_EVENT } = await loadSendControls({ mode: 'websocket' });
        setRequestInProgress(true);
        live.websocket.mockReturnValue(true);

        await notify(STREAM_STATE_EVENT);

        expect(cancelBtn().textContent).toBe('Cancel');
        expect(live.websocket).not.toHaveBeenCalled();
    });

    test('withRequestInProgress brackets the send and resets on failure', async () => {
        const { withRequestInProgress, setRequestRunning } = await loadSendControls();

        await expect(withRequestInProgress(async () => {
            expect(sendBtn().disabled).toBe(true);
            throw new Error('boom');
        })).rejects.toThrow('boom');

        expect(sendBtn().disabled).toBe(false);
        expect(setRequestRunning).toHaveBeenLastCalledWith(false);
    });
});
