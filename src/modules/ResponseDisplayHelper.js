/**
 * @fileoverview Helper for writing response data to per-tab or global response containers
 * @module ResponseDisplayHelper
 */

import { app } from './appContext.js';
import { extractCookies, renderCookies } from './cookieParser.js';
import { displayPerformanceMetrics, clearPerformanceMetrics } from './performanceMetrics.js';

/**
 * Resolves the correct response-container elements for a given tab,
 * falling back to the provided global DOM references.
 *
 * @param {string|null} tabId - Workspace tab ID (null for global fallback)
 * @param {Object}      globalElements - Global DOM fallback references
 * @param {HTMLElement}  [globalElements.headersDisplay]
 * @param {HTMLElement}  [globalElements.cookiesDisplay]
 * @param {HTMLElement}  [globalElements.performanceDisplay]
 * @returns {{ headersEditor: Object|null, cookiesDisplay: HTMLElement|null, performanceDisplay: HTMLElement|null, isPerTab: boolean }}
 */
export function getResponseElements(tabId, globalElements = {}) {
    const containerElements = tabId
        ? app.responseContainerManager?.getOrCreateContainer(tabId)
        : app.responseContainerManager?.getActiveElements();

    if (containerElements) {
        return {
            headersEditor: containerElements.headersEditor || null,
            cookiesDisplay: containerElements.cookiesDisplay || null,
            performanceDisplay: containerElements.performanceDisplay || null,
            isPerTab: true
        };
    }

    // Global fallback
    return {
        headersEditor: null,
        cookiesDisplay: globalElements.cookiesDisplay || null,
        performanceDisplay: globalElements.performanceDisplay || null,
        _headersDisplayFallback: globalElements.headersDisplay || null,
        isPerTab: false
    };
}

/**
 * Clears the headers, cookies, and performance panes for a response container.
 *
 * @param {string|null} tabId          - Workspace tab ID (null for global)
 * @param {Object}      globalElements - Global DOM fallback references
 */
export function clearResponsePanes(tabId, globalElements = {}) {
    const els = getResponseElements(tabId, globalElements);

    if (els.isPerTab) {
        if (els.headersEditor) { els.headersEditor.setContent('', 'application/json'); }
        if (els.cookiesDisplay) { renderCookies(els.cookiesDisplay, []); }
        if (els.performanceDisplay) { clearPerformanceMetrics(els.performanceDisplay); }
    } else {
        if (els._headersDisplayFallback) { els._headersDisplayFallback.textContent = ''; }
        if (els.cookiesDisplay) { renderCookies(els.cookiesDisplay, []); }
        if (els.performanceDisplay) { clearPerformanceMetrics(els.performanceDisplay); }
    }
}

/**
 * Writes response headers, cookies, and performance metrics to the correct pane.
 *
 * @param {string|null} tabId          - Workspace tab ID (null for global)
 * @param {Object}      globalElements - Global DOM fallback references
 * @param {Object}      opts
 * @param {Object|null} opts.headers   - Response headers object
 * @param {Object|null} opts.timings   - Performance timings
 * @param {number|null} opts.size      - Response size in bytes
 */
export function displayResponsePanes(tabId, globalElements, { headers, timings, size }) {
    const els = getResponseElements(tabId, globalElements);

    const headersString = headers
        ? JSON.stringify(headers, null, 2)
        : '';

    if (els.isPerTab) {
        if (els.headersEditor) {
            els.headersEditor.setContent(headersString || 'No response headers.', 'application/json');
        }
    } else if (els._headersDisplayFallback) {
        els._headersDisplayFallback.textContent = headersString || 'No response headers.';
    }

    const cookies = extractCookies(headers);
    if (els.cookiesDisplay) {
        renderCookies(els.cookiesDisplay, cookies);
    }

    if (timings) {
        if (els.performanceDisplay) {
            displayPerformanceMetrics(els.performanceDisplay, timings, size);
        }
    } else if (els.performanceDisplay) {
        clearPerformanceMetrics(els.performanceDisplay);
    }
}

/**
 * Writes error-specific headers, cookies, and performance metrics to the correct pane.
 *
 * @param {string|null} tabId          - Workspace tab ID (null for global)
 * @param {Object}      globalElements - Global DOM fallback references
 * @param {Object}      error          - The error/result object
 * @param {Object}      [error.headers]
 * @param {Object}      [error.timings]
 * @param {number}      [error.size]
 */
export function displayErrorResponsePanes(tabId, globalElements, error) {
    const els = getResponseElements(tabId, globalElements);

    if (error.headers && Object.keys(error.headers).length > 0) {
        try {
            const headersText = JSON.stringify(error.headers, null, 2);
            if (els.isPerTab && els.headersEditor) {
                els.headersEditor.setContent(headersText, 'application/json');
            } else if (els._headersDisplayFallback) {
                els._headersDisplayFallback.textContent = headersText;
            }
        } catch {
            const fallbackText = 'Error parsing response headers.';
            if (els.isPerTab && els.headersEditor) {
                els.headersEditor.setContent(fallbackText, 'application/json');
            } else if (els._headersDisplayFallback) {
                els._headersDisplayFallback.textContent = fallbackText;
            }
        }

        const cookies = extractCookies(error.headers);
        if (els.cookiesDisplay) {
            renderCookies(els.cookiesDisplay, cookies);
        }
    } else {
        const noHeadersText = 'No headers available for error response.';
        if (els.isPerTab && els.headersEditor) {
            els.headersEditor.setContent(noHeadersText, 'application/json');
        } else if (els._headersDisplayFallback) {
            els._headersDisplayFallback.textContent = noHeadersText;
        }

        if (els.cookiesDisplay) {
            renderCookies(els.cookiesDisplay, []);
        }
    }

    if (error.timings) {
        if (els.performanceDisplay) {
            displayPerformanceMetrics(els.performanceDisplay, error.timings, error.size);
        }
    } else if (els.performanceDisplay) {
        clearPerformanceMetrics(els.performanceDisplay);
    }
}
