/**
 * @fileoverview Which HTTP methods send the request body from the editor
 * @module utils/bodyMethods
 */

/** @type {ReadonlySet<string>} */
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/** @type {ReadonlySet<string>} */
const METHOD_INDEPENDENT_BODY_MODES = new Set(['formdata', 'urlencoded', 'binary']);

/**
 * @param {string|null|undefined} method
 * @returns {boolean}
 */
export function methodCarriesBody(method) {
    return !BODYLESS_METHODS.has(String(method || 'GET').toUpperCase());
}

/**
 * @param {string|null|undefined} method
 * @param {string} bodyMode
 * @returns {boolean}
 */
export function requestSendsBody(method, bodyMode) {
    return methodCarriesBody(method) || METHOD_INDEPENDENT_BODY_MODES.has(bodyMode);
}
