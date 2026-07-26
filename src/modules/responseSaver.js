/**
 * @fileoverview Save-response-to-file support. Preserves binary responses (which
 * the backend returns base64-encoded) and lets the user write any response body
 * to a file via a native save dialog.
 * @module responseSaver
 */

import { app } from './appContext.js';

/**
 * Per-tab metadata about the last response, used by the Save button.
 * @type {Map<string, {isBinary: boolean, base64: (string|null), suggestedName: string}>}
 */
const responseMeta = new Map();

const CONTENT_TYPE_EXTENSIONS = {
    'application/json': 'json',
    'text/html': 'html',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/octet-stream': 'bin',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
};

/**
 * Records metadata for the tab's most recent response.
 *
 * @param {string} tabId - Workspace tab ID.
 * @param {{isBinary: boolean, base64?: (string|null), suggestedName: string}} meta - Response metadata.
 * @returns {void}
 */
export function setResponseMeta(tabId, meta) {
    responseMeta.set(tabId, {
        isBinary: Boolean(meta.isBinary),
        base64: meta.base64 || null,
        suggestedName: meta.suggestedName || 'response'
    });
}

/**
 * @param {string} tabId - Workspace tab ID.
 * @returns {{isBinary: boolean, base64: (string|null), suggestedName: string}|null}
 */
export function getResponseMeta(tabId) {
    return responseMeta.get(tabId) || null;
}

/**
 * @param {string} tabId - Workspace tab ID.
 * @returns {void}
 */
export function clearResponseMeta(tabId) {
    responseMeta.delete(tabId);
}

/**
 * Derives a sensible default download filename from the request URL and the
 * response content type. Keeps an existing extension on the URL's last path
 * segment; otherwise appends one inferred from the content type.
 *
 * @param {string} url - The request URL.
 * @param {string} [contentType] - The response `Content-Type` header.
 * @returns {string} A suggested filename.
 */
export function suggestedFileName(url, contentType) {
    let base = 'response';
    try {
        const parsed = new URL(url);
        const segment = parsed.pathname.split('/').filter(Boolean).pop();
        if (segment) {
            base = segment;
        }
    } catch (e) {
        void e;
    }

    if (/\.[a-z0-9]{1,8}$/i.test(base)) {
        return base;
    }

    const ct = (contentType || '').split(';')[0].trim().toLowerCase();
    const ext = CONTENT_TYPE_EXTENSIONS[ct] || (ct.startsWith('text/') ? 'txt' : 'bin');
    return `${base}.${ext}`;
}

/**
 * Encodes a UTF-8 string to base64, chunking to avoid call-stack overflow on
 * large bodies.
 *
 * @param {string} text - The text to encode.
 * @returns {string} Base64-encoded UTF-8 bytes.
 */
export function textToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function showSaveFeedback(button, success) {
    if (!button) {
        return;
    }
    const originalTitle = button.title;
    button.title = success ? 'Saved!' : 'Save failed';
    button.classList.add(success ? 'copied' : 'copy-error');
    setTimeout(() => {
        button.title = originalTitle;
        button.classList.remove('copied', 'copy-error');
    }, 2000);
}

/**
 * Resolves the base64 payload and filename to save for a tab: the stored bytes
 * for a binary response, or the current editor text encoded to base64 otherwise.
 *
 * @param {string} tabId - Workspace tab ID.
 * @returns {{base64: string, defaultName: string}|null} Save payload, or null when there is nothing to save.
 */
export function resolveSavePayload(tabId) {
    const meta = getResponseMeta(tabId);

    if (meta && meta.isBinary) {
        if (!meta.base64) {
            return null;
        }
        return { base64: meta.base64, defaultName: meta.suggestedName };
    }

    const container = app.responseContainerManager?.getOrCreateContainer(tabId);
    const text = container?.editor ? container.editor.getContent() : '';
    if (!text || text.trim() === '') {
        return null;
    }

    return {
        base64: textToBase64(text),
        defaultName: meta?.suggestedName || 'response.txt'
    };
}

/**
 * Handles a Save-response button click for a tab.
 *
 * @param {HTMLElement} button - The save button.
 * @param {string} tabId - Workspace tab ID.
 * @returns {Promise<void>}
 */
export async function handleSaveResponse(button, tabId) {
    const payload = resolveSavePayload(tabId);
    if (!payload) {
        showSaveFeedback(button, false);
        return;
    }

    try {
        const result = await window.backendAPI.saveResponseBody(payload.defaultName, payload.base64);
        if (result && result.cancelled) {
            return;
        }
        showSaveFeedback(button, Boolean(result && result.success));
    } catch (e) {
        void e;
        showSaveFeedback(button, false);
    }
}

/**
 * Attaches the save handler to a response Save button.
 *
 * @param {HTMLElement} button - The save button.
 * @param {string} tabId - Workspace tab ID.
 * @returns {void}
 */
export function attachSaveResponseHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => handleSaveResponse(button, tabId));
    }
}
