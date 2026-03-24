import { getRequestBodyContent } from './requestBodyHelper.js';
import { clearResponseDisplayForTab, displayResponseWithLineNumbersForTab } from './apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';

const socketState = new Map();
let websocketListenerPromise = null;

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

function getSocketEntry(tabId) {
    return socketState.get(tabId) || null;
}

function setSocketEntry(tabId, entry) {
    socketState.set(tabId, entry);
}

function removeSocketEntry(tabId) {
    socketState.delete(tabId);
}

function buildTranscriptEntry(label, content = '') {
    const header = `[${getTimestamp()}] ${label}`;
    return content ? `${header}\n${content}` : header;
}

async function persistTranscript(tabId, transcript, url, state = 'closed') {
    if (!window.workspaceTabController || !tabId) {
        return;
    }

    const isOpen = state === 'open';
    await window.workspaceTabController.service.updateTab(tabId, {
        response: {
            data: transcript,
            headers: {},
            status: isOpen ? 101 : null,
            statusText: isOpen ? 'Switching Protocols' : '',
            ttfb: null,
            size: null,
            timings: null,
            cookies: [],
            websocket: {
                url,
                state
            }
        }
    });
}

async function appendTranscript(tabId, label, content = '', url = '') {
    const current = getSocketEntry(tabId) || {};
    const entry = buildTranscriptEntry(label, content);
    const existing = current.transcript || '';
    const transcript = existing ? `${existing}\n\n${entry}` : entry;
    const state = current.state || 'closed';

    setSocketEntry(tabId, {
        ...current,
        transcript
    });

    displayResponseWithLineNumbersForTab(transcript, 'text/plain', tabId);
    await persistTranscript(tabId, transcript, url || current.url || '', state);
}

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

async function updateStatusForTab(tabId, text, status = null) {
    if (await isTabCurrentlyActive(tabId)) {
        updateStatusDisplay(text, status);
        updateResponseTime(null);
        updateResponseSize(null);
    }
}

async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, url = '' } = payload;
    const current = getSocketEntry(tabId) || {};

    if (!tabId) {
        return;
    }

    if (current.url && url && current.url !== url && payload.eventType !== 'open') {
        return;
    }

    if (payload.eventType === 'open') {
        setSocketEntry(tabId, {
            ...current,
            url,
            state: 'open',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(tabId, 'WebSocket connected', 101);
        await appendTranscript(tabId, `CONNECTED ${url}`, '', url);
        return;
    }

    if (payload.eventType === 'message') {
        await updateStatusForTab(tabId, 'WebSocket message received', 101);
        await appendTranscript(tabId, 'RECEIVED', payload.message || '', url);
        return;
    }

    if (payload.eventType === 'close') {
        setSocketEntry(tabId, {
            ...current,
            url,
            state: 'closed',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(
            tabId,
            `WebSocket closed (${payload.code || 1000})`,
            null
        );
        await appendTranscript(
            tabId,
            `CLOSED ${payload.code || 1000}${payload.reason ? ` ${payload.reason}` : ''}`,
            '',
            url
        );
        return;
    }

    if (payload.eventType === 'error') {
        setSocketEntry(tabId, {
            ...current,
            url,
            state: current.state || 'closed',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(
            tabId,
            `WebSocket error${payload.message ? `: ${payload.message}` : ''}`,
            null
        );
        await appendTranscript(tabId, 'ERROR', payload.message || 'WebSocket error', url);
    }
}

export async function initWebSocketHandler() {
    if (websocketListenerPromise) {
        return websocketListenerPromise;
    }

    websocketListenerPromise = (async () => {
        if (!('__TAURI_INTERNALS__' in window) || !window.backendAPI?.websocket) {
            return;
        }

        const { invoke, transformCallback } = window.__TAURI_INTERNALS__;
        await invoke('plugin:event|listen', {
            event: 'websocket-event',
            target: { kind: 'Any' },
            handler: transformCallback(handleBackendEvent)
        });
    })();

    return websocketListenerPromise;
}

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

    const current = getSocketEntry(tabId);
    if (!current || current.url !== normalizedUrl) {
        setSocketEntry(tabId, {
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
        const currentState = getSocketEntry(tabId) || {};
        setSocketEntry(tabId, {
            ...currentState,
            url: normalizedUrl
        });
        await appendTranscript(tabId, 'SENT', message, normalizedUrl);
        await updateStatusForTab(tabId, 'WebSocket message sent', 101);
    } else {
        await updateStatusForTab(tabId, 'WebSocket connecting...', null);
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
    removeSocketEntry(tabId);
}
