/**
 * @fileoverview Builds a saved example from the response a workspace tab holds
 * @module examples/exampleFromResponse
 * @typedef {Object} SavedExample
 * @property {string} id
 * @property {string} name
 * @property {number} status
 * @property {string} [statusText]
 * @property {Array<{key: string, value: string}>} headers
 * @property {string} [contentType]
 * @property {string} [body]
 * @property {'base64'} [bodyEncoding]
 * @property {string} [savedAt]
 */

import { resolveProtocolId } from '../protocols/protocolRegistry.js';

export const STRIPPED_HEADERS = Object.freeze([
    'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'date', 'set-cookie'
]);

export const MAX_EXAMPLE_BODY_CHARS = 256 * 1024;

const EXAMPLE_PROTOCOLS = new Set(['http', 'graphql']);

/**
 * @param {function(): Date} [now]
 * @returns {string}
 */
export function newExampleId(now = () => new Date()) {
    return `ex_${now().getTime()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {Object|null|undefined} headers
 * @returns {Array<{key: string, value: string}>}
 */
export function exampleHeaders(headers) {
    return Object.entries(headers ?? {})
        .map(([key, value]) => ({ key: String(key).toLowerCase(), value: value === null || value === undefined ? '' : String(value) }))
        .filter((row) => row.key !== '' && !STRIPPED_HEADERS.includes(row.key));
}

/**
 * @param {Object} response
 * @returns {{body: string, bodyEncoding?: 'base64'}|null}
 */
function exampleBody(response) {
    if (response.isBinary) {
        return typeof response.bodyBase64 === 'string' ? { body: response.bodyBase64, bodyEncoding: 'base64' } : null;
    }
    const { data } = response;
    if (data === null || data === undefined) {
        return { body: '' };
    }
    if (typeof data === 'string') {
        return { body: data };
    }
    return { body: JSON.stringify(data, null, 2) };
}

/**
 * @param {Object|null} tab
 * @param {Object} [options]
 * @param {function(): Date} [options.now]
 * @param {function(): string} [options.id]
 * @returns {{ok: true, example: SavedExample}|{ok: false, reason: string}}
 */
export function exampleFromTab(tab, { now = () => new Date(), id = () => newExampleId(now) } = {}) {
    const collectionId = tab?.endpoint?.collectionId;
    const endpointId = tab?.endpoint?.endpointId;
    if (!collectionId || !endpointId) {
        return { ok: false, reason: 'unbound' };
    }
    if (!EXAMPLE_PROTOCOLS.has(resolveProtocolId(tab.request?.protocol))) {
        return { ok: false, reason: 'protocol' };
    }
    const { response } = tab;
    if (!response || !Number.isInteger(response.status)) {
        return { ok: false, reason: 'no_response' };
    }
    if (response.truncated) {
        return { ok: false, reason: 'truncated' };
    }
    const body = exampleBody(response);
    if (!body) {
        return { ok: false, reason: 'truncated' };
    }
    if (body.body.length > MAX_EXAMPLE_BODY_CHARS) {
        return { ok: false, reason: 'too_large' };
    }
    const headers = exampleHeaders(response.headers);
    const contentType = headers.find((row) => row.key === 'content-type')?.value;
    const example = {
        id: id(),
        name: '',
        status: response.status,
        headers,
        savedAt: now().toISOString(),
        ...body
    };
    if (response.statusText) {
        example.statusText = String(response.statusText);
    }
    if (contentType) {
        example.contentType = contentType;
    }
    return { ok: true, example };
}

/**
 * @param {SavedExample} example
 * @param {SavedExample[]} existing
 * @returns {string}
 */
export function defaultExampleName(example, existing = []) {
    const fromStatus = `${example.status} ${example.statusText ?? ''}`.trim();
    return fromStatus || `Example ${existing.length + 1}`;
}

/**
 * @param {string} name
 * @param {SavedExample[]} existing
 * @returns {string}
 */
export function uniqueExampleName(name, existing = []) {
    const taken = new Set(existing.map((example) => example.name));
    if (!taken.has(name)) {
        return name;
    }
    let counter = 2;
    while (taken.has(`${name} (${counter})`)) {
        counter += 1;
    }
    return `${name} (${counter})`;
}
