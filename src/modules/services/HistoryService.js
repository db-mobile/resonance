/**
 * @fileoverview Service for managing request history business logic
 * @module services/HistoryService
 */

import { HistoryRepository } from '../storage/HistoryRepository.js';
import { statusCategory } from '../utils/statusCategory.js';
import { grpcStatusName, isGrpcStatusOk } from '../utils/grpcStatus.js';

/**
 * Placeholder stored in place of a redacted credential value.
 * @type {string}
 */
export const REDACTED_PLACEHOLDER = '[redacted]';

/**
 * Request header names whose values are always redacted before a history entry
 * is persisted (case-insensitive).
 * @type {ReadonlyArray<string>}
 */
export const SENSITIVE_REQUEST_HEADERS = Object.freeze(['authorization', 'proxy-authorization', 'cookie']);

/**
 * Response header names whose values are always redacted before a history entry
 * is persisted (case-insensitive).
 * @type {ReadonlyArray<string>}
 */
export const SENSITIVE_RESPONSE_HEADERS = Object.freeze(['set-cookie']);

/**
 * Service for managing request history business logic
 *
 * @class
 * @classdesc Provides high-level history operations including history entry creation,
 * retrieval, search, and formatting utilities. Tracks request/response pairs with
 * timestamps and metadata for replay functionality. Includes UI helper methods
 * for formatting timestamps, colors, and URLs.
 */
export class HistoryService {
    /**
     * Creates a HistoryService instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.repository = new HistoryRepository(backendAPI);
        this.maxHistoryItems = 100;
    }

    /**
     * Generates a unique history entry ID
     *
     * @private
     * @returns {string} Unique history entry identifier
     */
    generateId() {
        return `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Creates a new history entry from request and response data
     *
     * Captures complete request/response state including method, URL, headers,
     * body, status, timing, and size information.
     *
     * @async
     * @param {Object} requestConfig - The request configuration
     * @param {string} requestConfig.method - HTTP method
     * @param {string} requestConfig.url - Request URL
     * @param {Object} [requestConfig.headers] - Request headers
     * @param {*} [requestConfig.body] - Request body
     * @param {Object} result - The request result
     * @param {boolean} result.success - Whether request was successful
     * @param {number} [result.status] - HTTP status code
     * @param {string} [result.statusText] - HTTP status text
     * @param {*} [result.data] - Response data
     * @param {Object} [result.headers] - Response headers
     * @param {number} [result.ttfb] - Time to first byte (ms)
     * @param {number} [result.size] - Response size (bytes)
     * @param {Object} [currentEndpoint=null] - Current endpoint context
     * @param {string} [currentEndpoint.collectionId] - Collection ID
     * @param {string} [currentEndpoint.endpointId] - Endpoint ID
     * @param {string} [environmentName=null] - Active environment name
     * @param {Object} [sensitive={}] - Extra credential locations to redact
     * @param {string[]} [sensitive.headerNames] - Request header names to redact (e.g. a configured API-key header)
     * @param {string[]} [sensitive.queryNames] - Query parameter names to redact (e.g. a configured API-key query param)
     * @returns {Promise<Object>} The created history entry
     */
    async createHistoryEntry(requestConfig, result, currentEndpoint = null, environmentName = null, sensitive = {}) {
        const headerNames = sensitive.headerNames || [];
        const queryNames = sensitive.queryNames || [];
        const responseHeaders = this._redactHeaders(result.headers, SENSITIVE_RESPONSE_HEADERS);

        const historyEntry = {
            id: this.generateId(),
            timestamp: Date.now(),
            environmentName: environmentName || null,
            request: {
                protocol: requestConfig.protocol || 'http',
                method: requestConfig.method,
                url: this._redactUrlQuery(requestConfig.url, queryNames),
                rawUrl: this._redactUrlQuery(requestConfig.rawUrl || requestConfig.url, queryNames),
                headers: this._redactHeaders(requestConfig.headers, SENSITIVE_REQUEST_HEADERS, headerNames),
                body: requestConfig.body || null,
                collectionId: currentEndpoint?.collectionId || null,
                endpointId: currentEndpoint?.endpointId || null,
                grpc: requestConfig.grpc || null
            },
            response: result.success || result.status ? {
                status: result.status ?? null,
                statusText: result.statusText || '',
                data: result.data || null,
                headers: responseHeaders,
                trailers: result.trailers || null,
                ttfb: result.ttfb || null,
                size: result.size || null
            } : {
                error: true,
                status: result.status || null,
                statusText: result.statusText || '',
                message: result.message || 'Unknown error',
                data: result.data || null,
                headers: responseHeaders,
                ttfb: result.ttfb || null,
                size: result.size || null
            },
            success: result.success || false
        };

        return this.repository.add(historyEntry);
    }

    /**
     * Returns a copy of a header map with sensitive values replaced by
     * {@link REDACTED_PLACEHOLDER}, matching header names case-insensitively.
     * Keys (and their original casing) are preserved so the request shape is
     * still visible in history.
     *
     * @private
     * @param {Object} headers - Header key-value map
     * @param {ReadonlyArray<string>} baseNames - Always-sensitive lowercased names
     * @param {string[]} [extraNames=[]] - Additional names to redact
     * @returns {Object} Redacted header map
     */
    _redactHeaders(headers, baseNames, extraNames = []) {
        if (!headers || typeof headers !== 'object') {
            return headers || {};
        }
        const sensitive = new Set([...baseNames, ...extraNames.map(name => String(name).toLowerCase())]);
        const redacted = {};
        for (const [key, value] of Object.entries(headers)) {
            redacted[key] = sensitive.has(key.toLowerCase()) ? REDACTED_PLACEHOLDER : value;
        }
        return redacted;
    }

    /**
     * Replaces the values of the named query parameters in a URL with
     * {@link REDACTED_PLACEHOLDER}, preserving the parameter names. Returns the
     * URL unchanged when it has no such parameters or cannot be parsed.
     *
     * @private
     * @param {string} url - The URL to redact
     * @param {string[]} [queryNames=[]] - Query parameter names to redact
     * @returns {string} Redacted URL
     */
    _redactUrlQuery(url, queryNames = []) {
        if (!url || queryNames.length === 0) {
            return url;
        }
        try {
            const parsed = new URL(url);
            let changed = false;
            for (const name of queryNames) {
                if (parsed.searchParams.has(name)) {
                    parsed.searchParams.set(name, REDACTED_PLACEHOLDER);
                    changed = true;
                }
            }
            return changed ? parsed.toString() : url;
        } catch (e) {
            void e;
            return url;
        }
    }

    /**
     * Retrieves all history entries
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of history entries, newest first
     */
    async getAllHistory() {
        return this.repository.getAll();
    }

    /**
     * Retrieves a specific history entry by ID
     *
     * @async
     * @param {string} id - The history entry ID
     * @returns {Promise<Object|null>} The history entry or null if not found
     */
    async getHistoryById(id) {
        return this.repository.getById(id);
    }

    /**
     * Deletes a specific history entry
     *
     * @async
     * @param {string} id - The history entry ID to delete
     * @returns {Promise<boolean>} True if deletion was successful
     */
    async deleteHistoryEntry(id) {
        return this.repository.delete(id);
    }

    /**
     * Clears all history entries
     *
     * @async
     * @returns {Promise<void>}
     */
    async clearAllHistory() {
        return this.repository.clear();
    }

    /**
     * Retrieves history entries for a specific collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Array<Object>>} Array of matching history entries
     */
    async getHistoryByCollection(collectionId) {
        return this.repository.getByCollection(collectionId);
    }

    /**
     * Searches history entries by term
     *
     * Searches across URL, method, and other request properties.
     *
     * @async
     * @param {string} searchTerm - The search term
     * @returns {Promise<Array<Object>>} Array of matching history entries
     */
    async searchHistory(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            return this.getAllHistory();
        }
        return this.repository.search(searchTerm);
    }

    /**
     * Formats a timestamp into human-readable relative time
     *
     * Returns "Just now", "X mins ago", "X hours ago", "X days ago", or full date.
     *
     * @param {number} timestamp - Unix timestamp in milliseconds
     * @returns {string} Formatted time string
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        } 
            return `${date.toLocaleDateString()  } ${  date.toLocaleTimeString()}`;
        
    }

    /**
     * Gets CSS color variable for HTTP status code
     *
     * Returns theme-aware color based on status code range:
     * - 2xx: success (green)
     * - 3xx: warning (yellow/orange)
     * - 4xx/5xx: error (red)
     *
     * @param {number} status - HTTP status code
     * @returns {string} CSS color variable or hex color
     */
    getStatusColor(status) {
        const colors = {
            success: 'var(--success-color, #10b981)',
            redirect: 'var(--warning-color, #f59e0b)',
            'client-error': 'var(--error-color, #ef4444)',
            'server-error': 'var(--error-color, #dc2626)',
            info: 'var(--text-secondary)'
        };
        return colors[statusCategory(status)];
    }

    /**
     * Gets CSS color variable for HTTP method
     *
     * Returns theme-aware color for common HTTP methods.
     *
     * @param {string} method - HTTP method (GET, POST, PUT, DELETE, PATCH)
     * @returns {string} CSS color variable or hex color
     */
    getMethodColor(method) {
        const colors = {
            'GET': 'var(--method-get, #10b981)',
            'POST': 'var(--method-post, #3b82f6)',
            'PUT': 'var(--method-put, #f59e0b)',
            'DELETE': 'var(--method-delete, #ef4444)',
            'PATCH': 'var(--method-patch, #8b5cf6)',
            'GRPC': 'var(--method-patch-color, #8939a4)'
        };
        return colors[method] || 'var(--text-secondary)';
    }

    /**
     * Decides how an entry's status badge should read. gRPC codes are named
     * rather than numbered, and code 0 (OK) is a success — testing it for
     * truthiness the way HTTP statuses are tested would render it as a failure.
     *
     * @param {Object} entry - History entry
     * @returns {{text: string, color: string}|null} Badge text and colour, or
     *   null when the entry has no status and should show the error badge
     */
    getStatusDisplay(entry) {
        const status = entry?.response?.status;

        if (entry?.request?.protocol === 'grpc') {
            if (status === null || status === undefined) {
                return null;
            }
            return {
                text: grpcStatusName(status),
                color: isGrpcStatusOk(status)
                    ? 'var(--success-color, #10b981)'
                    : 'var(--error-color, #ef4444)'
            };
        }

        if (!status) {
            return null;
        }
        return { text: String(status), color: this.getStatusColor(status) };
    }

    /**
     * Truncates a URL to maximum length for display
     *
     * @param {string} url - The URL to truncate
     * @param {number} [maxLength=50] - Maximum length before truncation
     * @returns {string} Truncated URL with ellipsis if needed
     */
    truncateUrl(url, maxLength = 50) {
        if (url.length <= maxLength) {return url;}
        return `${url.substring(0, maxLength - 3)  }...`;
    }
}
