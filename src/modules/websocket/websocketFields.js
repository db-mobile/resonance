/**
 * @fileoverview WebSocket request extras: offered sub-protocols and saved message presets, with the form read/write shared by every save/restore path
 * @module websocket/websocketFields
 */

import { app } from '../appContext.js';

export const PROTOCOLS_INPUT_ID = 'websocket-protocols-input';

/**
 * @typedef {Object} WebSocketMessagePreset
 * @property {string} id
 * @property {string} name
 * @property {'json'|'text'} mode
 * @property {string} content
 */

/**
 * @typedef {Object} WebSocketData
 * @property {string[]} protocols
 * @property {WebSocketMessagePreset[]} messages
 */

/** @type {Readonly<WebSocketData>} */
export const WEBSOCKET_DEFAULTS = Object.freeze({
    protocols: Object.freeze([]),
    messages: Object.freeze([])
});

/**
 * @param {*} value
 * @returns {string[]}
 */
export function parseProtocols(value) {
    const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
    const seen = new Set();
    const protocols = [];
    for (const entry of entries) {
        const token = String(entry ?? '').trim();
        if (!token || seen.has(token)) {
            continue;
        }
        seen.add(token);
        protocols.push(token);
    }
    return protocols;
}

/**
 * @param {string[]} protocols
 * @returns {string}
 */
export function formatProtocols(protocols) {
    return parseProtocols(protocols).join(', ');
}

/**
 * @param {*} value
 * @param {Set<string>} seen
 * @returns {WebSocketMessagePreset|null}
 */
function normalizeMessage(value, seen) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const suppliedId = typeof value.id === 'string' ? value.id : '';
    const id = suppliedId && !seen.has(suppliedId) ? suppliedId : crypto.randomUUID();
    seen.add(id);
    return {
        id,
        name: String(value.name ?? '').trim() || 'Untitled',
        mode: value.mode === 'text' ? 'text' : 'json',
        content: typeof value.content === 'string' ? value.content : String(value.content ?? '')
    };
}

/**
 * @param {Object|null|undefined} data
 * @returns {WebSocketData}
 */
export function normalizeWebSocketData(data) {
    const source = data && typeof data === 'object' ? data : {};
    const seen = new Set();
    const messages = Array.isArray(source.messages) ? source.messages : [];
    return {
        protocols: parseProtocols(source.protocols),
        messages: messages.map((entry) => normalizeMessage(entry, seen)).filter(Boolean)
    };
}

/** @returns {WebSocketData} */
export function readWebSocketForm() {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(PROTOCOLS_INPUT_ID));
    return normalizeWebSocketData({
        protocols: input?.value ?? '',
        messages: app.websocketPresets?.getMessages?.() ?? []
    });
}

/**
 * @param {Object|null|undefined} data
 * @returns {void}
 */
export function writeWebSocketForm(data) {
    const values = normalizeWebSocketData(data);
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(PROTOCOLS_INPUT_ID));
    if (input) {
        input.value = formatProtocols(values.protocols);
    }
    app.websocketPresets?.setMessages?.(values.messages);
}
