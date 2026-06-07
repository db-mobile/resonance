import { getRequestBodyContent } from './requestBodyHelper.js';
import { clearResponseDisplayForTab } from './apiHandler.js';
import { updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';
import {
    StreamSession,
    createBackendEventListener,
    getActiveTabId
} from './streaming/streamSession.js';

const session = new StreamSession({
    buildResponseMeta: (entry, transcript, state) => ({
        data: transcript,
        headers: {},
        status: state === 'open' ? 101 : null,
        statusText: state === 'open' ? 'Switching Protocols' : '',
        ttfb: null,
        size: null,
        timings: null,
        cookies: [],
        websocket: { url: entry.url || '', state }
    })
});

function normalizeWebSocketUrl(url) {
    if (!url) {
        return '';
    }

    if (/^wss?:\/\//i.test(url)) {
        return url;
    }

    if (/^https?:\/\//i.test(url)) {
        return url.replace(/^http/i, 'ws');
    }

    return `ws://${url}`;
}

async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, url = '' } = payload;
    const current = session.get(tabId) || {};

    if (!tabId) {
        return;
    }

    if (current.url && url && current.url !== url && payload.eventType !== 'open') {
        return;
    }

    if (payload.eventType === 'open') {
        session.set(tabId, {
            ...current,
            url,
            state: 'open',
            transcript: current.transcript || ''
        });
        await session.updateStatus(tabId, 'WebSocket connected', 101);
        await session.append(tabId, `CONNECTED ${url}`);
        return;
    }

    if (payload.eventType === 'message') {
        await session.updateStatus(tabId, 'WebSocket message received', 101);
        await session.append(tabId, 'RECEIVED', payload.message || '');
        return;
    }

    if (payload.eventType === 'close') {
        session.set(tabId, {
            ...current,
            url,
            state: 'closed',
            transcript: current.transcript || ''
        });
        await session.updateStatus(
            tabId,
            `WebSocket closed (${payload.code || 1000})`,
            null
        );
        await session.append(
            tabId,
            `CLOSED ${payload.code || 1000}${payload.reason ? ` ${payload.reason}` : ''}`
        );
        return;
    }

    if (payload.eventType === 'error') {
        session.set(tabId, {
            ...current,
            url,
            state: current.state || 'closed',
            transcript: current.transcript || ''
        });
        await session.updateStatus(
            tabId,
            `WebSocket error${payload.message ? `: ${payload.message}` : ''}`,
            null
        );
        await session.append(tabId, 'ERROR', payload.message || 'WebSocket error');
    }
}

export const initWebSocketHandler = createBackendEventListener(
    'websocket-event',
    () => !!window.backendAPI?.websocket,
    handleBackendEvent
);

export async function handleWebSocketSend(url, headers = {}) {
    await initWebSocketHandler();

    if (!window.backendAPI?.websocket) {
        toast.error('WebSocket backend is not available');
        return;
    }

    const tabId = await getActiveTabId();
    const normalizedUrl = normalizeWebSocketUrl(url?.trim());

    if (!normalizedUrl) {
        toast.error('WebSocket URL is required');
        return;
    }

    const current = session.get(tabId);
    if (!current || current.url !== normalizedUrl) {
        session.set(tabId, {
            url: normalizedUrl,
            state: 'connecting',
            transcript: ''
        });
        clearResponseDisplayForTab(tabId);
    }

    const message = getRequestBodyContent();

    try {
        await window.backendAPI.websocket.send({
            tabId,
            url: normalizedUrl,
            message,
            headers
        });
    } catch (error) {
        toast.error(`WebSocket connection failed: ${error.message}`);
        return;
    }

    if (message) {
        const currentState = session.get(tabId) || {};
        session.set(tabId, {
            ...currentState,
            url: normalizedUrl
        });
        await session.append(tabId, 'SENT', message);
        await session.updateStatus(tabId, 'WebSocket message sent', 101);
    } else {
        await session.updateStatus(tabId, 'WebSocket connecting...', null);
    }
}

export async function handleWebSocketCancel() {
    const tabId = await getActiveTabId();

    if (!window.backendAPI?.websocket) {
        updateStatusDisplay('WebSocket backend is not available', null);
        return false;
    }

    await window.backendAPI.websocket.close(tabId);
    return true;
}

export async function clearWebSocketState(tabId) {
    if (window.backendAPI?.websocket && tabId) {
        await window.backendAPI.websocket.close(tabId);
    }
    session.remove(tabId);
}
