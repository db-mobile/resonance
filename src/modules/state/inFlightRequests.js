/**
 * @fileoverview Cancellation ids of the requests currently in flight, one per tab
 * @module state/inFlightRequests
 */

const NO_TAB = '__no_tab__';

/** @type {Map<string, string>} */
const byTab = new Map();

let fallbackCounter = 0;

/** @returns {string} */
export function newRequestId() {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) {
        return uuid;
    }
    fallbackCounter += 1;
    return `req-${Date.now()}-${fallbackCounter}`;
}

/**
 * @param {string|null} tabId
 * @param {string} requestId
 * @returns {function(): void}
 */
export function trackInFlight(tabId, requestId) {
    const key = tabId ?? NO_TAB;
    byTab.set(key, requestId);
    return () => {
        if (byTab.get(key) === requestId) {
            byTab.delete(key);
        }
    };
}

/**
 * @param {string|null} tabId
 * @returns {string|null}
 */
export function inFlightRequestFor(tabId) {
    return byTab.get(tabId ?? NO_TAB) ?? null;
}
