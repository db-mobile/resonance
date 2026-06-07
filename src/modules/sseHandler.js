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
        status: state === 'open' ? 200 : null,
        statusText: state === 'open' ? 'OK' : '',
        ttfb: null,
        size: null,
        timings: null,
        cookies: [],
        sse: { url: entry.url || '', state }
    })
});

function formatMessage(payload) {
    const parts = [];
    if (payload.event) {
        parts.push(`event: ${payload.event}`);
    }
    if (payload.id) {
        parts.push(`id: ${payload.id}`);
    }
    if (payload.retry !== null && payload.retry !== undefined) {
        parts.push(`retry: ${payload.retry}`);
    }
    if (payload.data !== null && payload.data !== undefined) {
        parts.push(payload.data);
    }
    return parts.join('\n');
}

async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, url = '' } = payload;
    if (!tabId) {
        return;
    }
    const current = session.get(tabId) || {};

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
        await session.updateStatus(tabId, 'SSE connected', payload.status || 200);
        await session.append(tabId, `CONNECTED ${url}`);
        return;
    }

    if (payload.eventType === 'reopen') {
        await session.updateStatus(tabId, 'SSE reconnected', payload.status || 200);
        await session.append(tabId, `RECONNECTED ${url}`);
        return;
    }

    if (payload.eventType === 'reconnecting') {
        await session.updateStatus(tabId, 'SSE reconnecting...', null);
        const retry = payload.retry ? ` in ${payload.retry}ms` : '';
        await session.append(tabId, `RECONNECTING${retry}`);
        return;
    }

    if (payload.eventType === 'message') {
        if (payload.id) {
            session.set(tabId, { ...(session.get(tabId) || {}), lastEventId: payload.id });
        }
        await session.updateStatus(tabId, 'SSE event received', 200);
        await session.append(tabId, 'EVENT', formatMessage(payload));
        return;
    }

    if (payload.eventType === 'close') {
        session.set(tabId, {
            ...current,
            url,
            state: 'closed',
            transcript: current.transcript || ''
        });
        await session.updateStatus(tabId, 'SSE closed', null);
        await session.append(tabId, 'CLOSED');
        return;
    }

    if (payload.eventType === 'error') {
        session.set(tabId, {
            ...current,
            url,
            state: current.state || 'closed',
            transcript: current.transcript || ''
        });
        const statusInfo = payload.status ? ` (HTTP ${payload.status})` : '';
        await session.updateStatus(
            tabId,
            `SSE error${payload.message ? `: ${payload.message}` : ''}`,
            payload.status || null
        );
        await session.append(tabId, `ERROR${statusInfo}`, payload.message || 'SSE error');
    }
}

export const initSseHandler = createBackendEventListener(
    'sse-event',
    () => !!window.backendAPI?.sse,
    handleBackendEvent
);

export async function handleSseConnect(url, headers = {}) {
    await initSseHandler();

    if (!window.backendAPI?.sse) {
        toast.error('SSE backend is not available');
        return;
    }

    const tabId = await getActiveTabId();
    const trimmed = (url || '').trim();
    if (!trimmed) {
        toast.error('SSE URL is required');
        return;
    }

    const current = session.get(tabId);
    const lastEventId = current?.lastEventId || null;

    if (!current || current.url !== trimmed) {
        session.set(tabId, {
            url: trimmed,
            state: 'connecting',
            transcript: '',
            lastEventId: null
        });
        clearResponseDisplayForTab(tabId);
    }

    try {
        await window.backendAPI.sse.connect({
            tabId,
            url: trimmed,
            headers,
            lastEventId
        });
        await session.updateStatus(tabId, 'SSE connecting...', null);
    } catch (error) {
        toast.error(`SSE connection failed: ${error.message || error}`);
    }
}

export async function handleSseCancel() {
    const tabId = await getActiveTabId();
    if (!window.backendAPI?.sse) {
        updateStatusDisplay('SSE backend is not available', null);
        return false;
    }
    await window.backendAPI.sse.close(tabId);
    return true;
}

export async function clearSseState(tabId) {
    if (window.backendAPI?.sse && tabId) {
        await window.backendAPI.sse.close(tabId);
    }
    session.remove(tabId);
}
