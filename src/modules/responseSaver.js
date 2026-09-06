/**
 * @fileoverview Save-response-to-file support.
 * @module responseSaver
 */

import { app } from './appContext.js';
import { textToBase64 } from './utils/encoding.js';

/** @type {Map<string, {isBinary: boolean, base64: (string|null), suggestedName: string}>} */
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
 * @param {string} tabId
 * @param {{isBinary: boolean, base64?: (string|null), suggestedName: string}} meta
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
 * @param {string} tabId
 * @returns {{isBinary: boolean, base64: (string|null), suggestedName: string}|null}
 */
export function getResponseMeta(tabId) {
    return responseMeta.get(tabId) || null;
}

/**
 * @param {string} tabId
 * @returns {void}
 */
export function clearResponseMeta(tabId) {
    responseMeta.delete(tabId);
}

/**
 * @param {string} url
 * @param {string} [contentType]
 * @returns {string}
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

export { textToBase64 };

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
 * @param {string} tabId
 * @returns {{base64: string, defaultName: string}|null}
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
 * @param {HTMLElement} button
 * @param {string} tabId
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
 * @param {HTMLElement} button
 * @param {string} tabId
 * @returns {void}
 */
export function attachSaveResponseHandler(button, tabId) {
    if (button) {
        button.addEventListener('click', () => handleSaveResponse(button, tabId));
    }
}
