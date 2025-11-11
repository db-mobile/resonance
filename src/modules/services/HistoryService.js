/**
 * @fileoverview Service for managing request history business logic
 * @module services/HistoryService
 */

import { HistoryRepository } from '../storage/HistoryRepository.js';

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
     * @param {Object} electronAPI - The Electron IPC API bridge
     */
    constructor(electronAPI) {
        this.repository = new HistoryRepository(electronAPI);
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
     * @returns {Promise<Object>} The created history entry
     */
    async createHistoryEntry(requestConfig, result, currentEndpoint = null) {
        const historyEntry = {
            id: this.generateId(),
            timestamp: Date.now(),
            request: {
                method: requestConfig.method,
                url: requestConfig.url,
                headers: requestConfig.headers || {},
                body: requestConfig.body || null,
                collectionId: currentEndpoint?.collectionId || null,
                endpointId: currentEndpoint?.endpointId || null
            },
            response: result.success || result.status ? {
                status: result.status || null,
                statusText: result.statusText || '',
                data: result.data || null,
                headers: result.headers || {},
                ttfb: result.ttfb || null,
                size: result.size || null
            } : {
                error: true,
                status: result.status || null,
                statusText: result.statusText || '',
                message: result.message || 'Unknown error',
                data: result.data || null,
                headers: result.headers || {},
                ttfb: result.ttfb || null,
                size: result.size || null
            },
            success: result.success || false
        };

        return this.repository.add(historyEntry);
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
        if (!status) {return 'var(--text-secondary)';}
        if (status >= 200 && status < 300) {return 'var(--success-color, #10b981)';}
        if (status >= 300 && status < 400) {return 'var(--warning-color, #f59e0b)';}
        if (status >= 400 && status < 500) {return 'var(--error-color, #ef4444)';}
        if (status >= 500) {return 'var(--error-color, #dc2626)';}
        return 'var(--text-secondary)';
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
            'PATCH': 'var(--method-patch, #8b5cf6)'
        };
        return colors[method] || 'var(--text-secondary)';
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
