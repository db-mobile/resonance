/**
 * @fileoverview Pure helpers for the graphql-transport-ws protocol: client message
 * builders, endpoint URL normalization, and operation-type selection. Kept free of
 * DOM/IPC dependencies so they are trivially unit-testable.
 * @module graphqlTransportWs
 */

/**
 * Convert an http(s) endpoint URL to its ws(s) equivalent. URLs already using a
 * ws scheme are returned unchanged; scheme-less inputs default to `ws://`.
 * @param {string} url
 * @returns {string}
 */
export function normalizeSubscriptionUrl(url) {
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

/**
 * Build a `connection_init` frame, attaching a payload only when non-empty.
 * @param {object} [payload]
 * @returns {{type: 'connection_init', payload?: object}}
 */
export function buildConnectionInit(payload) {
    const msg = { type: 'connection_init' };
    if (payload && Object.keys(payload).length > 0) {
        msg.payload = payload;
    }
    return msg;
}

/**
 * Build a `subscribe` frame. Variables/operationName are omitted when absent.
 * @param {string} id
 * @param {{query: string, variables?: object, operationName?: string|null}} op
 */
export function buildSubscribe(id, { query, variables, operationName }) {
    const payload = { query };
    if (variables && Object.keys(variables).length > 0) {
        payload.variables = variables;
    }
    if (operationName) {
        payload.operationName = operationName;
    }
    return { id, type: 'subscribe', payload };
}

/**
 * Build a client `complete` frame (unsubscribe).
 * @param {string} id
 */
export function buildComplete(id) {
    return { id, type: 'complete' };
}

/**
 * Build a `pong` frame (reply to a server `ping`).
 */
export function buildPong() {
    return { type: 'pong' };
}

/**
 * Resolve the operation type ('query' | 'mutation' | 'subscription') that the next
 * Run should execute, given the parsed operations and the picker's selection.
 * @param {Array<{name: string|null, type: string}>|null} operations
 * @param {string|null} [selectedName]
 * @returns {string|null}
 */
export function selectActiveOperationType(operations, selectedName) {
    if (!Array.isArray(operations) || operations.length === 0) {
        return null;
    }
    if (selectedName) {
        const match = operations.find((op) => op.name === selectedName);
        if (match) {
            return match.type;
        }
    }
    const named = operations.find((op) => op.name);
    return (named || operations[0]).type;
}
