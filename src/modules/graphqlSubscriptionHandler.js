/**
 * @fileoverview GraphQL subscriptions over WebSocket using the graphql-transport-ws
 * @module graphqlSubscriptionHandler
 */

import { clearResponseDisplayForTab } from './apiHandler.js';
import { resolveTlsOptions } from './tlsOptions.js';
import { toast } from './ui/Toast.js';
import {
    StreamSession,
    createBackendEventListener,
    getActiveTabId
} from './streaming/streamSession.js';
import {
    normalizeSubscriptionUrl,
    buildConnectionInit,
    buildSubscribe,
    buildComplete,
    buildPong
} from './graphqlTransportWs.js';

const SUB_ID = '1';

const session = new StreamSession({
    buildResponseMeta: (entry, transcript, state) => ({
        data: transcript,
        headers: {},
        status: state === 'open' ? 101 : null,
        statusText: state === 'open' ? 'Subscription Active' : '',
        ttfb: null,
        size: null,
        timings: null,
        cookies: [],
        graphqlSubscription: { url: entry.url || '', state }
    })
});

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseMessage(raw) {
    if (typeof raw !== 'string') {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (_e) {
        return null;
    }
}

async function sendFrame(tabId, entry, messageObj) {
    await window.backendAPI.graphqlSubscription.send({
        tabId,
        url: entry.url,
        headers: entry.headers || {},
        message: JSON.stringify(messageObj),
        ...(entry.tls || {})
    });
}

const ORIGINAL_LABELS = new WeakMap();

/**
 * @param {HTMLElement|null} btn
 * @param {boolean} active
 * @param {string} stopHtml
 */
function setButtonStop(btn, active, stopHtml) {
    if (!btn) {
        return;
    }
    if (!ORIGINAL_LABELS.has(btn)) {
        ORIGINAL_LABELS.set(btn, { html: btn.innerHTML, title: btn.title });
    }
    const original = ORIGINAL_LABELS.get(btn);
    if (active) {
        btn.innerHTML = stopHtml;
        btn.title = 'Stop subscription';
    } else {
        btn.innerHTML = original.html;
        btn.title = original.title;
    }
}

async function refreshRunButton(tabId, active) {
    if ((await getActiveTabId()) !== tabId) {
        return;
    }
    setButtonStop(document.getElementById('send-request-btn'), active, 'Stop');
}

async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, url = '' } = payload;
    if (!tabId) {
        return;
    }
    const current = session.get(tabId);
    if (!current) {
        return;
    }

    if (current.url && url && current.url !== url && payload.eventType !== 'open') {
        return;
    }

    if (payload.eventType === 'open') {
        session.set(tabId, { ...current, url, state: 'open' });
        await session.updateStatus(tabId, 'Subscription connected', 101);
        await session.append(tabId, `CONNECTED ${url}`);
        return;
    }

    if (payload.eventType === 'message') {
        const msg = parseMessage(payload.message);
        if (!msg) {
            await session.append(tabId, 'RECEIVED', payload.message || '');
            return;
        }
        await handleProtocolMessage(tabId, current, msg);
        return;
    }

    if (payload.eventType === 'close') {
        session.set(tabId, { ...current, url, state: 'closed' });
        await session.updateStatus(tabId, `Subscription closed (${payload.code || 1000})`, null);
        await session.append(
            tabId,
            `CLOSED ${payload.code || 1000}${payload.reason ? ` ${payload.reason}` : ''}`
        );
        await refreshRunButton(tabId, false);
        return;
    }

    if (payload.eventType === 'error') {
        session.set(tabId, { ...current, url, state: current.state || 'closed' });
        await session.updateStatus(
            tabId,
            `Subscription error${payload.message ? `: ${payload.message}` : ''}`,
            null
        );
        await session.append(tabId, 'ERROR', payload.message || 'Subscription error');
        await refreshRunButton(tabId, false);
    }
}

async function handleProtocolMessage(tabId, entry, msg) {
    switch (msg.type) {
        case 'connection_ack': {
            session.set(tabId, { ...entry, state: 'open', acked: true });
            await session.append(tabId, 'ACK', 'connection acknowledged');
            await sendFrame(tabId, entry, buildSubscribe(SUB_ID, {
                query: entry.query,
                variables: entry.variables,
                operationName: entry.operationName
            }));
            await session.append(tabId, 'SUBSCRIBE', entry.operationName || '(anonymous)');
            return;
        }
        case 'next': {
            await session.updateStatus(tabId, 'Subscription event received', 101);
            await session.append(tabId, 'DATA', JSON.stringify(msg.payload, null, 2));
            return;
        }
        case 'error': {
            await session.append(tabId, 'ERROR', JSON.stringify(msg.payload, null, 2));
            return;
        }
        case 'complete': {
            await session.append(tabId, 'COMPLETE', 'server completed the subscription');
            await session.updateStatus(tabId, 'Subscription complete', null);
            return;
        }
        case 'ping': {
            await sendFrame(tabId, entry, buildPong());
            return;
        }
        default:
            await session.append(tabId, 'RECEIVED', JSON.stringify(msg));
    }
}

export const initGraphQLSubscriptionHandler = createBackendEventListener(
    'graphql-subscription-event',
    () => !!window.backendAPI?.graphqlSubscription,
    handleBackendEvent
);

/** @param {{url: string, headers?: object, query: string, variables?: object, operationName?: string|null}} opts */
export async function handleGraphQLSubscriptionStart({ url, headers = {}, query, variables = {}, operationName = null }) {
    await initGraphQLSubscriptionHandler();

    if (!window.backendAPI?.graphqlSubscription) {
        toast.error('GraphQL subscription backend is not available');
        return;
    }

    const normalizedUrl = normalizeSubscriptionUrl(url?.trim());
    if (!normalizedUrl) {
        toast.error('GraphQL endpoint URL is required');
        return;
    }
    if (!query || !query.trim()) {
        toast.error('Subscription query is empty');
        return;
    }

    const tabId = await getActiveTabId();

    const entry = {
        url: normalizedUrl,
        headers,
        query,
        variables,
        operationName,
        tls: await resolveTlsOptions(normalizedUrl),
        state: 'connecting',
        acked: false,
        transcript: ''
    };
    session.set(tabId, entry);
    clearResponseDisplayForTab(tabId);
    await session.updateStatus(tabId, 'Subscription connecting...', null);
    await refreshRunButton(tabId, true);

    try {
        await sendFrame(tabId, entry, buildConnectionInit());
    } catch (error) {
        await session.append(tabId, 'ERROR', `Connection failed: ${error.message || error}`);
        await session.updateStatus(tabId, 'Subscription connection failed', null);
        await refreshRunButton(tabId, false);
    }
}

/** @returns {Promise<boolean>} */
export async function handleGraphQLSubscriptionCancel() {
    const tabId = await getActiveTabId();
    const entry = session.get(tabId);

    if (!window.backendAPI?.graphqlSubscription || !entry || entry.state === 'closed') {
        return false;
    }

    try {
        if (entry.acked) {
            await sendFrame(tabId, entry, buildComplete(SUB_ID));
        }
        await window.backendAPI.graphqlSubscription.close(tabId);
    } catch (_e) {
        void _e;
    }

    session.set(tabId, { ...entry, state: 'closed' });
    await session.updateStatus(tabId, 'Subscription stopped', null);
    await session.append(tabId, 'STOPPED', 'subscription stopped by user');
    await refreshRunButton(tabId, false);
    return true;
}

/**
 * @param {string} tabId
 * @returns {boolean}
 */
export function isSubscriptionActive(tabId) {
    const entry = session.get(tabId);
    return !!entry && entry.state !== 'closed';
}

/** @param {string} tabId */
export async function clearGraphQLSubscriptionState(tabId) {
    if (window.backendAPI?.graphqlSubscription && tabId) {
        try {
            await window.backendAPI.graphqlSubscription.close(tabId);
        } catch (_e) {
            void _e;
        }
    }
    session.remove(tabId);
}
