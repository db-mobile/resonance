import { getRequestBodyContent } from './requestBodyHelper.js';
import { app } from './appContext.js';
import { clearResponseDisplayForTab } from './responseView.js';
import { normalizeWsUrl } from './graphqlTransportWs.js';
import { resolveTlsOptions } from './tlsOptions.js';
import { resolveRequestSettings } from './state/settingsCache.js';
import { toast } from './ui/Toast.js';
import {
    StreamSession, createBackendEventListener, getActiveTabId, transcriptResponseMeta
} from './streaming/streamSession.js';
import { isLiveEntry, notifyStreamStateChanged } from './streaming/streamState.js';

const session = new StreamSession({
    protocol: 'WebSocket',
    newestFirst: true,
    buildResponseMeta: transcriptResponseMeta({ status: 101, statusText: 'Switching Protocols', key: 'websocket' })
});

function owns(tabId, attempt) {
    return session.get(tabId)?.attempt === attempt;
}

async function reportError(tabId, attempt, error, terminal = true, transportFailure = true) {
    if (!owns(tabId, attempt) || attempt.cancelled || (transportFailure && attempt.errorReported)) { return; }
    if (transportFailure) { attempt.errorReported = true; }
    const message = error?.message || String(error || 'WebSocket connection failed');
    const current = session.get(tabId);
    if (terminal) { session.transition(tabId, current, { state: 'closed' }); }
    toast.error(`WebSocket error: ${message}`);
    await session.append(tabId, 'ERROR', message);
    if (owns(tabId, attempt)) {
        const open = getWebSocketState(tabId) === 'open';
        await session.updateStatus(tabId, open ? 'WebSocket connected' : 'WebSocket disconnected', open ? 101 : null);
    }
}

async function recordCancellation(tabId, attempt) {
    if (!owns(tabId, attempt) || attempt.cancelRecorded) { return; }
    attempt.cancelRecorded = true;
    session.transition(tabId, session.get(tabId), { state: 'closed' });
    await session.append(tabId, 'CANCELLED');
    if (owns(tabId, attempt)) { await session.updateStatus(tabId, 'WebSocket disconnected', null); }
}

async function handleBackendEvent({ payload = {} }) {
    const { tabId, connectionId, eventType } = payload;
    const current = session.get(tabId);
    if (!current || current.connectionId !== connectionId) { return; }
    const { attempt } = current;
    if (eventType === 'open') {
        if (current.state !== 'connecting' || attempt.stopRequested) { return; }
        session.transition(tabId, current, { state: 'open' });
        await session.append(tabId, `CONNECTED ${current.url}${payload.protocol ? ` [${payload.protocol}]` : ''}`);
        if (owns(tabId, attempt)) { await session.updateStatus(tabId, 'WebSocket connected', 101); }
    } else if (eventType === 'message') {
        if (current.state !== 'open' || attempt.stopRequested) { return; }
        await session.append(tabId, 'RECEIVED', payload.message || '');
        if (owns(tabId, attempt)) { await session.updateStatus(tabId, 'WebSocket message received', 101); }
    } else if (eventType === 'cancelled') {
        await recordCancellation(tabId, attempt);
    } else if (eventType === 'error') {
        await reportError(tabId, attempt, payload.message, current.state === 'connecting');
    } else if (eventType === 'close') {
        if (current.state === 'closed') { return; }
        const code = payload.code ?? 1005;
        session.transition(tabId, current, { state: 'closed' });
        if (code === 1006 && !attempt.errorReported) {
            await reportError(tabId, attempt, payload.reason || 'Connection closed abnormally');
        }
        if (!owns(tabId, attempt)) { return; }
        await session.append(tabId, `CLOSED ${code}${payload.reason ? ` ${payload.reason}` : ''}`);
        if (owns(tabId, attempt)) { await session.updateStatus(tabId, `WebSocket closed (${code})`, null); }
    }
}

export const initWebSocketHandler = createBackendEventListener(
    'websocket-event', () => !!window.backendAPI?.websocket, handleBackendEvent
);

/** Start preparation immediately so Cancel can invalidate work before any IPC call. */
export async function handleWebSocketConnect({ tabId, url, headers = {}, protocols = [], prepare }) {
    if (!tabId) { tabId = await getActiveTabId(); }
    if (isWebSocketLive(tabId)) { return; }
    const previous = session.get(tabId);
    const attempt = { stopRequested: false, cancelled: false, registration: null, errorReported: false };
    const connectionId = crypto.randomUUID();
    session.set(tabId, { url, connectionId, attempt, state: 'connecting', transcript: previous?.transcript || '' });
    try {
        await initWebSocketHandler();
        if (!window.backendAPI?.websocket) { throw new Error('WebSocket backend is not available'); }
        const prepared = prepare ? await prepare() : { url, headers, protocols };
        if (!owns(tabId, attempt) || attempt.stopRequested) { return; }
        const normalizedUrl = normalizeWsUrl(prepared.url?.trim());
        if (!normalizedUrl) { throw new Error('WebSocket URL is required'); }
        const parsed = new URL(normalizedUrl);
        if (!['ws:', 'wss:'].includes(parsed.protocol)) { throw new Error('WebSocket URL must use ws:// or wss://'); }
        const changedUrl = previous?.url !== normalizedUrl;
        session.transition(tabId, session.get(tabId), { url: normalizedUrl, ...(changedUrl ? { transcript: '' } : {}) });
        if (changedUrl) { clearResponseDisplayForTab(tabId); }
        const [tls, settings] = await Promise.all([resolveTlsOptions(normalizedUrl), resolveRequestSettings()]);
        if (!owns(tabId, attempt) || attempt.stopRequested) { return; }
        await session.updateStatus(tabId, 'WebSocket connecting...', null);
        if (!owns(tabId, attempt) || attempt.stopRequested) { return; }
        const offered = Array.isArray(prepared.protocols) ? prepared.protocols.filter(Boolean) : [];
        attempt.registration = window.backendAPI.websocket.connect({
            tabId, connectionId, url: normalizedUrl, headers: prepared.headers || {},
            ...(offered.length ? { protocols: offered } : {}),
            ...tls, connectTimeoutMs: settings.timeout
        });
        await attempt.registration;
    } catch (error) {
        await reportError(tabId, attempt, error);
    }
}

/** Read either composer verbatim; choosing JSON does not implicitly format the payload. */
export function getWebSocketBodyContent() {
    return document.getElementById('body-mode-select')?.value === 'text'
        ? (app.requestBodyTextEditor?.getContent() || '')
        : getRequestBodyContent();
}

/** Send only on the captured connection; preparing a message must never reconnect. */
export async function handleWebSocketSend(message = getWebSocketBodyContent(), tabId, prepare) {
    if (!tabId) { tabId = await getActiveTabId(); }
    const current = session.get(tabId);
    if (!current || current.state !== 'open') {
        toast.error('WebSocket is not connected');
        return;
    }
    const { attempt, connectionId } = current;
    if (attempt.sending) { return; }
    attempt.sending = true;
    attempt.errorReported = false;
    notifyStreamStateChanged();
    let preparing = true;
    try {
        const body = prepare ? await prepare(message) : message;
        preparing = false;
        if (!owns(tabId, attempt) || attempt.stopRequested || getWebSocketState(tabId) !== 'open') { return; }
        await window.backendAPI.websocket.send({ tabId, connectionId, message: body });
        if (!owns(tabId, attempt) || attempt.stopRequested) { return; }
        await session.append(tabId, 'SENT', body);
        if (owns(tabId, attempt)) { await session.updateStatus(tabId, 'WebSocket message sent', 101); }
    } catch (error) {
        await reportError(tabId, attempt, error, false, !preparing);
    } finally {
        attempt.sending = false;
        notifyStreamStateChanged();
    }
}

async function stopBackend(tabId, entry) {
    if (!entry.attempt.registration) { return; }
    try { await entry.attempt.registration; } catch { return; }
    await window.backendAPI?.websocket?.close(tabId, entry.connectionId);
}

export async function handleWebSocketCancel(tabId) {
    if (!tabId) { tabId = await getActiveTabId(); }
    const entry = session.get(tabId);
    if (!entry || ['closed', 'closing'].includes(entry.state)) { return false; }
    const { attempt } = entry;
    attempt.cancelled = entry.state === 'connecting';
    attempt.stopRequested = true;
    session.transition(tabId, entry, { state: 'closing' });
    if (!attempt.registration) {
        await recordCancellation(tabId, attempt);
    } else {
        try {
            await stopBackend(tabId, entry);
            // A rejected registration has no lifecycle task to send a terminal event.
            if (attempt.cancelled) { await recordCancellation(tabId, attempt); }
        } catch (error) {
            attempt.cancelled = false;
            await reportError(tabId, attempt, error);
        }
    }
    return true;
}

export async function clearWebSocketState(tabId) {
    const entry = session.get(tabId);
    if (!entry) { return; }
    entry.attempt.stopRequested = true;
    entry.attempt.cancelled = true;
    session.remove(tabId);
    await stopBackend(tabId, entry);
}

/** Clear live or restored messages while leaving the socket and request untouched. */
export async function clearWebSocketTranscript(tabId) {
    if (!tabId) { tabId = await getActiveTabId(); }
    if (!tabId) { return; }
    if (session.get(tabId)) {
        await session.clearTranscript(tabId);
    } else {
        clearResponseDisplayForTab(tabId);
        await app.workspaceTabController?.service.updateTab(tabId, { response: null });
    }
}

export function getWebSocketState(tabId) { return session.get(tabId)?.state || 'closed'; }
export function isWebSocketSending(tabId) { return Boolean(session.get(tabId)?.attempt.sending); }
export function isWebSocketLive(tabId) { return isLiveEntry(session.get(tabId)); }
