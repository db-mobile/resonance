/**
 * @fileoverview Which requests the collection runner can execute
 * @module utils/runnableRequests
 */

/** @type {ReadonlySet<string>} */
export const RUNNABLE_PROTOCOLS = new Set(['http', 'graphql']);

/**
 * @param {Object} endpoint
 * @returns {boolean}
 */
export function isRunnable(endpoint) {
    return RUNNABLE_PROTOCOLS.has(endpoint?.protocol || 'http');
}
