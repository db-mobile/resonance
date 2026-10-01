/**
 * @fileoverview Helper for writing response data to per-tab or global response containers
 * @module ResponseDisplayHelper
 */

import { app } from './appContext.js';
import { responseCookies, renderCookies } from './cookieParser.js';
import { displayPerformanceMetrics, clearPerformanceMetrics } from './performanceMetrics.js';

/**
 * @param {string|null} tabId
 * @returns {Object|null|undefined}
 */
export function responseContainerFor(tabId) {
    return tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();
}

/**
 * @param {string|null} tabId
 * @param {Object} globalElements
 * @param {HTMLElement} [globalElements.headersDisplay]
 * @param {HTMLElement} [globalElements.cookiesDisplay]
 * @param {HTMLElement} [globalElements.performanceDisplay]
 * @returns {{ headersEditor: Object|null, cookiesDisplay: HTMLElement|null, performanceDisplay: HTMLElement|null, _headersDisplayFallback?: HTMLElement|null }}
 */
function getResponseElements(tabId, globalElements = {}) {
    const containerElements = responseContainerFor(tabId);

    if (containerElements) {
        containerElements.renderedResponse = null;
        return {
            headersEditor: containerElements.headersEditor || null,
            cookiesDisplay: containerElements.cookiesDisplay || null,
            performanceDisplay: containerElements.performanceDisplay || null
        };
    }

    return {
        headersEditor: null,
        cookiesDisplay: globalElements.cookiesDisplay || null,
        performanceDisplay: globalElements.performanceDisplay || null,
        _headersDisplayFallback: globalElements.headersDisplay || null
    };
}

/**
 * @param {Object} els
 * @param {string} text
 * @returns {void}
 */
function writeHeadersText(els, text) {
    if (els.headersEditor) {
        els.headersEditor.setContent(text, 'application/json');
    } else if (els._headersDisplayFallback) {
        els._headersDisplayFallback.textContent = text;
    }
}

/**
 * @param {Object} els
 * @param {Object|null|undefined} timings
 * @param {number|null|undefined} size
 * @returns {void}
 */
function writePerformance(els, timings, size) {
    if (!els.performanceDisplay) {
        return;
    }
    if (timings) {
        displayPerformanceMetrics(els.performanceDisplay, timings, size);
    } else {
        clearPerformanceMetrics(els.performanceDisplay);
    }
}

/**
 * @param {string|null} tabId
 * @param {Object} globalElements
 */
export function clearResponsePanes(tabId, globalElements = {}) {
    const els = getResponseElements(tabId, globalElements);

    writeHeadersText(els, '');
    if (els.cookiesDisplay) { renderCookies(els.cookiesDisplay, []); }
    if (els.performanceDisplay) { clearPerformanceMetrics(els.performanceDisplay); }
}

/**
 * @param {string|null} tabId
 * @param {Object} globalElements
 * @param {Object} opts
 * @param {Object|null} opts.headers
 * @param {Object|null} opts.timings
 * @param {number|null} opts.size
 * @param {Array<string>} [opts.setCookies]
 */
export function displayResponsePanes(tabId, globalElements, { headers, timings, size, setCookies }) {
    const els = getResponseElements(tabId, globalElements);

    const headersString = headers
        ? JSON.stringify(headers, null, 2)
        : '';

    writeHeadersText(els, headersString || 'No response headers.');

    const cookies = responseCookies({ headers, setCookies });
    if (els.cookiesDisplay) {
        renderCookies(els.cookiesDisplay, cookies);
    }

    writePerformance(els, timings, size);
}

/**
 * @param {string|null} tabId
 * @param {Object} globalElements
 * @param {Object} error
 * @param {Object} [error.headers]
 * @param {Object} [error.timings]
 * @param {number} [error.size]
 */
export function displayErrorResponsePanes(tabId, globalElements, error) {
    const els = getResponseElements(tabId, globalElements);

    if (error.headers && Object.keys(error.headers).length > 0) {
        try {
            writeHeadersText(els, JSON.stringify(error.headers, null, 2));
        } catch {
            writeHeadersText(els, 'Error parsing response headers.');
        }

        const cookies = responseCookies(error);
        if (els.cookiesDisplay) {
            renderCookies(els.cookiesDisplay, cookies);
        }
    } else {
        writeHeadersText(els, 'No headers available for error response.');

        if (els.cookiesDisplay) {
            renderCookies(els.cookiesDisplay, []);
        }
    }

    writePerformance(els, error.timings, error.size);
}

/**
 * @param {Object|null|undefined} containerElements
 * @param {{metadata: Object, trailers: Object}} panes
 * @returns {void}
 */
export function renderGrpcPanes(containerElements, { metadata, trailers }) {
    if (!containerElements) {
        return;
    }
    if (containerElements.metadataDisplay) {
        containerElements.metadataDisplay.textContent = JSON.stringify(metadata || {}, null, 2);
    }
    if (containerElements.trailersDisplay) {
        containerElements.trailersDisplay.textContent = JSON.stringify(trailers || {}, null, 2);
    }
}
