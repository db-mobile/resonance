/**
 * WorkspaceTabStateManager
 *
 * Manages capturing and restoring tab state from/to UI elements.
 * Bridges workspace tabs with the existing UI.
 */
import { parseKeyValuePairs, populateKeyValueList, clearKeyValueList, addKeyValueRow, updateUrlFromQueryParams } from './keyValueManager.js';
import { authManager } from './authManager.js';
import { displayResponseWithLineNumbers, clearResponseDisplay } from './apiHandler.js';
import { updateStatusDisplay, updateResponseTime, updateResponseSize } from './statusDisplay.js';
import logger from './logger.js';

const _log = logger.scope('WorkspaceTabStateManager');
import { displayPerformanceMetrics, clearPerformanceMetrics } from './performanceMetrics.js';
import { formatCookiesAsHtml } from './cookieParser.js';
import { activateTab } from './tabManager.js';

export class WorkspaceTabStateManager {
    constructor(domElements) {
        this.dom = domElements;
    }

    /**
     * Capture current state from UI elements
     * @returns {Promise<Object>}
     */
    async captureCurrentState() {
        const pathParams = parseKeyValuePairs(this.dom.pathParamsList);
        const queryParams = parseKeyValuePairs(this.dom.queryParamsList);
        const headers = parseKeyValuePairs(this.dom.headersList);

        const authConfig = authManager.getAuthConfig();
        // authConfig has structure: { type: 'bearer', config: {...} }

        // Capture active response tab
        const activeResponseTab = this._getActiveResponseTab();

        return {
            request: {
                url: this.dom.urlInput?.value || '',
                method: this.dom.methodSelect?.value || 'GET',
                pathParams,
                queryParams,
                headers,
                body: this.dom.bodyInput?.value || '',
                authType: authConfig.type || 'none',
                authConfig: authConfig.config || {}
            },
            // Capture current endpoint reference for variable substitution
            endpoint: window.currentEndpoint ? {
                collectionId: window.currentEndpoint.collectionId,
                endpointId: window.currentEndpoint.endpointId,
                path: window.currentEndpoint.path,
                method: window.currentEndpoint.method
            } : null,
            // Capture active response tab
            activeResponseTab: activeResponseTab
            // Response is captured when request completes (handled separately)
        };
    }

    /**
     * Get the currently active response tab ID
     * @private
     * @returns {string}
     */
    _getActiveResponseTab() {
        const activeResponseTab = document.querySelector('.response-tabs .tab-button.active');
        if (activeResponseTab) {
            return activeResponseTab.dataset.tab;
        }
        return 'response-body'; // Default to body tab
    }

    /**
     * Restore tab state to UI elements
     * @param {Object} tab
     * @returns {Promise<void>}
     */
    async restoreTabState(tab) {
        if (!tab) {
            return;
        }

        // Ensure request object exists
        if (!tab.request) {
            // Initialize with empty request state
            tab.request = {
                url: '',
                method: 'GET',
                pathParams: {},
                queryParams: {},
                headers: { 'Content-Type': 'application/json' },
                body: '',
                authType: 'none',
                authConfig: {}
            };
        }

        // Use tab.request directly to avoid stale destructured references
        const {request} = tab;
        const {response} = tab;
        const {endpoint} = tab;

        // Restore request fields
        if (this.dom.urlInput) {
            this.dom.urlInput.value = request.url || '';
        }

        if (this.dom.methodSelect) {
            this.dom.methodSelect.value = request.method || 'GET';
        }

        if (this.dom.bodyInput) {
            this.dom.bodyInput.value = request.body || '';
        }

        // Restore path params
        if (this.dom.pathParamsList) {
            clearKeyValueList(this.dom.pathParamsList);
            if (request.pathParams && Object.keys(request.pathParams).length > 0) {
                populateKeyValueList(this.dom.pathParamsList, request.pathParams);
            } else {
                addKeyValueRow(this.dom.pathParamsList);
            }
        }

        // Restore query params
        if (this.dom.queryParamsList) {
            clearKeyValueList(this.dom.queryParamsList);
            if (request.queryParams && Object.keys(request.queryParams).length > 0) {
                populateKeyValueList(this.dom.queryParamsList, request.queryParams);
                // Update URL to include query params
                updateUrlFromQueryParams();
            } else {
                // Add empty row if no query params
                addKeyValueRow(this.dom.queryParamsList);
            }
        }

        // Restore headers
        if (this.dom.headersList) {
            clearKeyValueList(this.dom.headersList);
            if (request.headers && Object.keys(request.headers).length > 0) {
                populateKeyValueList(this.dom.headersList, request.headers);
            } else {
                addKeyValueRow(this.dom.headersList, 'Content-Type', 'application/json');
            }
        }

        // Restore auth
        if (authManager) {
            const authType = request.authType || 'none';
            const authConfig = {
                type: authType,
                config: request.authConfig || {}
            };
            authManager.loadAuthConfig(authConfig);
        }

        // Restore active response tab FIRST, before restoring response data
        const activeResponseTab = tab.activeResponseTab || 'response-body';
        activateTab('response', activeResponseTab);

        // Restore response if it exists
        if (response) {
            await this._restoreResponse(response);
        } else {
            this._clearResponse();
        }

        // Store endpoint reference globally for compatibility with existing code
        // Always update window.currentEndpoint to match the tab's endpoint state
        // This ensures variable substitution uses the correct collection context
        if (endpoint) {
            window.currentEndpoint = endpoint;

            // Load scripts for this endpoint
            if (window.inlineScriptManager && endpoint.collectionId && endpoint.endpointId) {
                await window.inlineScriptManager.loadScripts(endpoint.collectionId, endpoint.endpointId);
            }
        } else if (Object.prototype.hasOwnProperty.call(tab, 'endpoint')) {
            // Tab explicitly has no endpoint (e.g., manually created tab)
            window.currentEndpoint = null;

            // Clear scripts when no endpoint
            if (window.inlineScriptManager) {
                window.inlineScriptManager.clear();
            }
        }
        // If tab doesn't have endpoint property at all (old tab format),
        // leave window.currentEndpoint as-is for backwards compatibility
    }

    /**
     * Update tab with response data
     * @param {string} tabId
     * @param {Object} responseData
     * @returns {Object} Update object for tab
     */
    captureResponse(responseData) {
        return {
            response: {
                data: responseData.data,
                headers: responseData.headers || {},
                status: responseData.status,
                statusText: responseData.statusText,
                ttfb: responseData.ttfb,
                size: responseData.size,
                timings: responseData.timings,
                cookies: responseData.cookies || []
            }
        };
    }

    /**
     * Restore response to UI (private)
     * @private
     */
    async _restoreResponse(response) {
        if (!response) {
            this._clearResponse();
            return;
        }

        // Restore response body with CodeMirror
        if (response.data) {
            const formattedResponse = JSON.stringify(response.data, null, 2);
            const contentType = response.headers?.['content-type'] || null;
            displayResponseWithLineNumbers(formattedResponse, contentType);
        } else {
            clearResponseDisplay();
        }

        // Restore response headers
        if (this.dom.responseHeadersDisplay) {
            if (response.headers && Object.keys(response.headers).length > 0) {
                this.dom.responseHeadersDisplay.textContent = JSON.stringify(response.headers, null, 2);
            } else {
                this.dom.responseHeadersDisplay.textContent = 'No response headers.';
            }
        }

        // Restore cookies
        if (this.dom.responseCookiesDisplay) {
            if (response.cookies && response.cookies.length > 0) {
                this.dom.responseCookiesDisplay.innerHTML = formatCookiesAsHtml(response.cookies);
            } else {
                this.dom.responseCookiesDisplay.innerHTML = '<div class="cookies-empty">No cookies in response</div>';
            }
        }

        // Restore performance metrics
        if (this.dom.responsePerformanceDisplay) {
            if (response.performanceHTML) {
                // Restore the saved HTML directly
                this.dom.responsePerformanceDisplay.innerHTML = response.performanceHTML;
            } else if (response.timings) {
                // Generate from timings if HTML not saved
                displayPerformanceMetrics(this.dom.responsePerformanceDisplay, response.timings, response.size);
            } else {
                clearPerformanceMetrics(this.dom.responsePerformanceDisplay);
            }
        }

        // Restore status display
        if (response.status) {
            updateStatusDisplay(`Status: ${response.status} ${response.statusText || ''}`, response.status);
        } else {
            updateStatusDisplay('Ready', null);
        }

        // Restore response time
        updateResponseTime(response.ttfb);

        // Restore response size
        updateResponseSize(response.size);
    }

    /**
     * Clear response display
     * @private
     */
    _clearResponse() {
        // Clear response body
        clearResponseDisplay();

        // Clear status display
        updateStatusDisplay('Ready', null);

        // Clear response time and size
        updateResponseTime(null);
        updateResponseSize(null);

        // Clear response headers
        if (this.dom.responseHeadersDisplay) {
            this.dom.responseHeadersDisplay.textContent = '';
        }

        // Clear cookies
        if (this.dom.responseCookiesDisplay) {
            this.dom.responseCookiesDisplay.innerHTML = '';
        }

        // Clear performance metrics
        if (this.dom.responsePerformanceDisplay) {
            clearPerformanceMetrics(this.dom.responsePerformanceDisplay);
        }
    }

    /**
     * Create a new empty state
     * @returns {Object}
     */
    createEmptyState() {
        return {
            request: {
                url: '',
                method: 'GET',
                pathParams: {},
                queryParams: {},
                headers: { 'Content-Type': 'application/json' },
                body: '',
                authType: 'none',
                authConfig: {}
            },
            response: null,
            endpoint: null,
            activeResponseTab: 'response-body'
        };
    }
}
