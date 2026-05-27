import { clearResponseDisplayForTab, displayResponseWithLineNumbersForTab } from './apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';

const sseState = new Map();
let sseListenerPromise = null;

function getTimestamp() {
    return new Date().toLocaleTimeString();
}

async function getActiveTabId() {
    return window.workspaceTabController
        ? window.workspaceTabController.service.getActiveTabId()
        : null;
}

async function isTabCurrentlyActive(tabId) {
    if (!tabId || !window.workspaceTabController) {
        return true;
    }
    const activeTabId = await window.workspaceTabController.service.getActiveTabId();
    return activeTabId === tabId;
}

function getEntry(tabId) {
    return sseState.get(tabId) || null;
}

function setEntry(tabId, entry) {
    sseState.set(tabId, entry);
}

function removeEntry(tabId) {
    sseState.delete(tabId);
}

function buildLine(label, content = '') {
    const header = `[${getTimestamp()}] ${label}`;
    return content ? `${header}\n${content}` : header;
}

async function persistTranscript(tabId, transcript, url, state) {
    if (!window.workspaceTabController || !tabId) {
        return;
    }
    const isOpen = state === 'open';
    await window.workspaceTabController.service.updateTab(tabId, {
        response: {
            data: transcript,
            headers: {},
            status: isOpen ? 200 : null,
            statusText: isOpen ? 'OK' : '',
            ttfb: null,
            size: null,
            timings: null,
            cookies: [],
            sse: { url, state }
        }
    });
}

async function append(tabId, label, content = '', url = '') {
    const current = getEntry(tabId) || {};
    const entry = buildLine(label, content);
    const existing = current.transcript || '';
    const transcript = existing ? `${existing}\n\n${entry}` : entry;
    const state = current.state || 'closed';

    setEntry(tabId, { ...current, transcript });

    displayResponseWithLineNumbersForTab(transcript, 'text/plain', tabId);
    await persistTranscript(tabId, transcript, url || current.url || '', state);
}

async function updateStatusForTab(tabId, text, status = null) {
    if (await isTabCurrentlyActive(tabId)) {
        updateStatusDisplay(text, status);
        updateResponseTime(null);
        updateResponseSize(null);
    }
}

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
    const current = getEntry(tabId) || {};

    if (current.url && url && current.url !== url && payload.eventType !== 'open') {
        return;
    }

    if (payload.eventType === 'open') {
        setEntry(tabId, {
            ...current,
            url,
            state: 'open',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(tabId, 'SSE connected', payload.status || 200);
        await append(tabId, `CONNECTED ${url}`, '', url);
        return;
    }

    if (payload.eventType === 'reopen') {
        await updateStatusForTab(tabId, 'SSE reconnected', payload.status || 200);
        await append(tabId, `RECONNECTED ${url}`, '', url);
        return;
    }

    if (payload.eventType === 'reconnecting') {
        await updateStatusForTab(tabId, 'SSE reconnecting...', null);
        const retry = payload.retry ? ` in ${payload.retry}ms` : '';
        await append(tabId, `RECONNECTING${retry}`, '', url);
        return;
    }

    if (payload.eventType === 'message') {
        if (payload.id) {
            setEntry(tabId, { ...(getEntry(tabId) || {}), lastEventId: payload.id });
        }
        await updateStatusForTab(tabId, 'SSE event received', 200);
        await append(tabId, 'EVENT', formatMessage(payload), url);
        return;
    }

    if (payload.eventType === 'close') {
        setEntry(tabId, {
            ...current,
            url,
            state: 'closed',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(tabId, 'SSE closed', null);
        await append(tabId, 'CLOSED', '', url);
        return;
    }

    if (payload.eventType === 'error') {
        setEntry(tabId, {
            ...current,
            url,
            state: current.state || 'closed',
            transcript: current.transcript || ''
        });
        const statusInfo = payload.status ? ` (HTTP ${payload.status})` : '';
        await updateStatusForTab(
            tabId,
            `SSE error${payload.message ? `: ${payload.message}` : ''}`,
            payload.status || null
        );
        await append(tabId, `ERROR${statusInfo}`, payload.message || 'SSE error', url);
    }
}

export async function initSseHandler() {
    if (sseListenerPromise) {
        return sseListenerPromise;
    }

    sseListenerPromise = (async () => {
        if (!('__TAURI_INTERNALS__' in window) || !window.backendAPI?.sse) {
            return;
        }
        const { invoke, transformCallback } = window.__TAURI_INTERNALS__;
        await invoke('plugin:event|listen', {
            event: 'sse-event',
            target: { kind: 'Any' },
            handler: transformCallback(handleBackendEvent)
        });
    })();

    return sseListenerPromise;
}

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

    const current = getEntry(tabId);
    const lastEventId = current?.lastEventId || null;

    if (!current || current.url !== trimmed) {
        setEntry(tabId, {
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
        await updateStatusForTab(tabId, 'SSE connecting...', null);
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
    removeEntry(tabId);
}
