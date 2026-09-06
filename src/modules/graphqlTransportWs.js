/**
 * @fileoverview Pure helpers for the graphql-transport-ws protocol: client message
 * @module graphqlTransportWs
 */

/**
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

/** @param {string} id */
export function buildComplete(id) {
    return { id, type: 'complete' };
}

export function buildPong() {
    return { type: 'pong' };
}

/**
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
