/**
 * @fileoverview Which HTTP methods send the request body from the editor
 * @module utils/bodyMethods
 */

/** @type {ReadonlySet<string>} */
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/**
 * @param {string|null|undefined} method
 * @returns {boolean}
 */
export function methodCarriesBody(method) {
    return !BODYLESS_METHODS.has(String(method || 'GET').toUpperCase());
}
