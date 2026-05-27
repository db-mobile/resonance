import { displayResponseWithLineNumbersForTab } from './apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';

const streamState = new Map();
let listenerPromise = null;

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
    return streamState.get(tabId) || null;
}

function setEntry(tabId, entry) {
    streamState.set(tabId, entry);
}

function removeEntry(tabId) {
    streamState.delete(tabId);
}

function buildTranscriptEntry(label, content = '') {
    const header = `[${getTimestamp()}] ${label}`;
    return content ? `${header}\n${content}` : header;
}

async function updateStatusForTab(tabId, text) {
    if (await isTabCurrentlyActive(tabId)) {
        updateStatusDisplay(text, null);
        updateResponseTime(null);
        updateResponseSize(null);
    }
}

async function appendTranscript(tabId, label, content = '') {
    const current = getEntry(tabId) || {};
    const entry = buildTranscriptEntry(label, content);
    const existing = current.transcript || '';
    const transcript = existing ? `${existing}\n\n${entry}` : entry;

    setEntry(tabId, { ...current, transcript });
    displayResponseWithLineNumbersForTab(transcript, 'text/plain', tabId);
}

function formatMessage(message) {
    if (message === null || message === undefined) {
        return '';
    }
    if (typeof message === 'string') {
        return message;
    }
    try {
        return JSON.stringify(message, null, 2);
    } catch (_) {
        return String(message);
    }
}

async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, eventType, fullMethod } = payload;
    if (!tabId) {
        return;
    }
    const current = getEntry(tabId) || {};

    if (eventType === 'open') {
        setEntry(tabId, {
            ...current,
            fullMethod,
            state: 'open',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(tabId, 'gRPC stream open');
        await appendTranscript(tabId, `OPEN ${fullMethod}`);
        return;
    }

    if (eventType === 'message') {
        await updateStatusForTab(tabId, 'gRPC message received');
        await appendTranscript(tabId, 'RECEIVED', formatMessage(payload.message));
        return;
    }

    if (eventType === 'error') {
        await updateStatusForTab(tabId, `gRPC error: ${payload.statusMessage || 'unknown'}`);
        await appendTranscript(
            tabId,
            `ERROR ${payload.status ?? ''}`,
            payload.statusMessage || ''
        );
        return;
    }

    if (eventType === 'close') {
        setEntry(tabId, {
            ...current,
            fullMethod,
            state: 'closed',
            transcript: current.transcript || ''
        });
        const trailerStr = payload.trailers ? `\n${JSON.stringify(payload.trailers, null, 2)}` : '';
        await updateStatusForTab(
            tabId,
            `gRPC stream closed (${payload.statusMessage || payload.status || 'OK'})`
        );
        await appendTranscript(
            tabId,
            `CLOSED ${payload.status ?? 0} ${payload.statusMessage || ''}`.trim(),
            trailerStr.trim()
        );
    }
}

export async function initGrpcStreamHandler() {
    if (listenerPromise) {
        return listenerPromise;
    }

    listenerPromise = (async () => {
        if (!('__TAURI_INTERNALS__' in window) || !window.backendAPI?.grpc?.streamStart) {
            return;
        }
        const { invoke, transformCallback } = window.__TAURI_INTERNALS__;
        await invoke('plugin:event|listen', {
            event: 'grpc-stream-event',
            target: { kind: 'Any' },
            handler: transformCallback(handleBackendEvent)
        });
    })();

    return listenerPromise;
}

export function hasActiveStream(tabId) {
    const entry = getEntry(tabId);
    return !!(entry && entry.state === 'open');
}

export function getStreamMethod(tabId) {
    const entry = getEntry(tabId);
    return entry?.fullMethod || null;
}

/**
 * Start a new stream or push another message into an open client/bidi stream.
 * @param {object} opts - {target, fullMethod, requestJson, metadata, tls, protoPath, canSend}
 *   canSend=true for client-streaming or bidi (the stream accepts additional messages).
 */
export async function startOrSend(opts) {
    await initGrpcStreamHandler();

    if (!window.backendAPI?.grpc?.streamStart) {
        toast.error('gRPC streaming backend is not available');
        return;
    }

    const tabId = await getActiveTabId();
    if (!tabId) {
        toast.error('No active tab');
        return;
    }

    const current = getEntry(tabId);
    const sameMethod = current?.fullMethod === opts.fullMethod;

    // If a stream that accepts client messages is already open on the same
    // method, push another message instead of reopening.
    if (opts.canSend && current?.state === 'open' && sameMethod) {
        try {
            await window.backendAPI.grpc.streamSend(tabId, opts.requestJson);
            await appendTranscript(tabId, 'SENT', formatMessage(opts.requestJson));
            await updateStatusForTab(tabId, 'gRPC message sent');
        } catch (error) {
            toast.error(`gRPC send error: ${error.message || String(error)}`);
        }
        return;
    }

    // Otherwise, start a fresh stream (this closes any previous stream for the tab)
    setEntry(tabId, {
        fullMethod: opts.fullMethod,
        state: 'connecting',
        transcript: ''
    });
    displayResponseWithLineNumbersForTab('', null, tabId);

    try {
        await window.backendAPI.grpc.streamStart({
            tabId,
            target: opts.target,
            fullMethod: opts.fullMethod,
            requestJson: opts.requestJson,
            metadata: opts.metadata || {},
            tls: opts.tls || { useTls: false, skipVerify: false },
            protoPath: opts.protoPath || null
        });
        if (opts.canSend && opts.requestJson !== undefined && opts.requestJson !== null) {
            await appendTranscript(tabId, 'SENT', formatMessage(opts.requestJson));
        }
    } catch (error) {
        removeEntry(tabId);
        const msg = error.message || String(error);
        toast.error(`gRPC stream error: ${msg}`);
        await appendTranscript(tabId, 'ERROR', msg);
        await updateStatusForTab(tabId, `gRPC stream error: ${msg}`);
    }
}

export async function cancelStream(tabId) {
    const targetTabId = tabId || (await getActiveTabId());
    if (!targetTabId || !window.backendAPI?.grpc?.streamCancel) {
        return false;
    }
    try {
        await window.backendAPI.grpc.streamCancel(targetTabId);
        return true;
    } catch (_) {
        return false;
    }
}

export async function clearStreamState(tabId) {
    if (tabId && window.backendAPI?.grpc?.streamCancel) {
        try {
            await window.backendAPI.grpc.streamCancel(tabId);
        } catch (_) {
            // ignore
        }
    }
    removeEntry(tabId);
}
