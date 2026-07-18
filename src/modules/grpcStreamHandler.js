import { displayResponseWithLineNumbersForTab } from './apiHandler.js';
import { toast } from './ui/Toast.js';
import {
    StreamSession,
    createBackendEventListener,
    getActiveTabId
} from './streaming/streamSession.js';

const session = new StreamSession();

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
    const current = session.get(tabId) || {};

    if (eventType === 'open') {
        session.set(tabId, {
            ...current,
            fullMethod,
            state: 'open',
            transcript: current.transcript || ''
        });
        await session.updateStatus(tabId, 'gRPC stream open');
        await session.append(tabId, `OPEN ${fullMethod}`);
        return;
    }

    if (eventType === 'message') {
        await session.updateStatus(tabId, 'gRPC message received');
        await session.append(tabId, 'RECEIVED', formatMessage(payload.message));
        return;
    }

    if (eventType === 'error') {
        await session.updateStatus(tabId, `gRPC error: ${payload.statusMessage || 'unknown'}`);
        await session.append(
            tabId,
            `ERROR ${payload.status ?? ''}`,
            payload.statusMessage || ''
        );
        return;
    }

    if (eventType === 'close') {
        session.set(tabId, {
            ...current,
            fullMethod,
            state: 'closed',
            transcript: current.transcript || ''
        });
        const trailerStr = payload.trailers ? `\n${JSON.stringify(payload.trailers, null, 2)}` : '';
        await session.updateStatus(
            tabId,
            `gRPC stream closed (${payload.statusMessage || payload.status || 'OK'})`
        );
        await session.append(
            tabId,
            `CLOSED ${payload.status ?? 0} ${payload.statusMessage || ''}`.trim(),
            trailerStr.trim()
        );
    }
}

export const initGrpcStreamHandler = createBackendEventListener(
    'grpc-stream-event',
    () => !!window.backendAPI?.grpc?.streamStart,
    handleBackendEvent
);

export function hasActiveStream(tabId) {
    const entry = session.get(tabId);
    return !!(entry && entry.state === 'open');
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

    const current = session.get(tabId);
    const sameMethod = current?.fullMethod === opts.fullMethod;

    if (opts.canSend && current?.state === 'open' && sameMethod) {
        try {
            await window.backendAPI.grpc.streamSend(tabId, opts.requestJson);
            await session.append(tabId, 'SENT', formatMessage(opts.requestJson));
            await session.updateStatus(tabId, 'gRPC message sent');
        } catch (error) {
            toast.error(`gRPC send error: ${error.message || String(error)}`);
        }
        return;
    }

    session.set(tabId, {
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
            await session.append(tabId, 'SENT', formatMessage(opts.requestJson));
        }
    } catch (error) {
        session.remove(tabId);
        const msg = error.message || String(error);
        toast.error(`gRPC stream error: ${msg}`);
        await session.append(tabId, 'ERROR', msg);
        await session.updateStatus(tabId, `gRPC stream error: ${msg}`);
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
        }
    }
    session.remove(tabId);
}
