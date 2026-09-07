/**
 * @fileoverview Service for managing request history business logic
 * @module services/HistoryService
 */

import { HistoryRepository } from '../storage/HistoryRepository.js';
import { statusCategory } from '../utils/statusCategory.js';
import { grpcStatusName, isGrpcStatusOk } from '../utils/grpcStatus.js';

/** @type {string} */
export const REDACTED_PLACEHOLDER = '[redacted]';

/** @type {ReadonlyArray<string>} */
export const SENSITIVE_REQUEST_HEADERS = Object.freeze(['authorization', 'proxy-authorization', 'cookie']);

/** @type {ReadonlyArray<string>} */
export const SENSITIVE_RESPONSE_HEADERS = Object.freeze(['set-cookie']);

export class HistoryService {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.repository = new HistoryRepository(backendAPI);
        this.maxHistoryItems = 100;
    }

    /** @returns {string} */
    generateId() {
        return `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * @param {Object} requestConfig
     * @param {string} requestConfig.method
     * @param {string} requestConfig.url
     * @param {Object} [requestConfig.headers]
     * @param {*} [requestConfig.body]
     * @param {Object} result
     * @param {boolean} result.success
     * @param {number} [result.status]
     * @param {string} [result.statusText]
     * @param {*} [result.data]
     * @param {Object} [result.headers]
     * @param {number} [result.ttfb]
     * @param {number} [result.size]
     * @param {Object} [currentEndpoint=null]
     * @param {string} [currentEndpoint.collectionId]
     * @param {string} [currentEndpoint.endpointId]
     * @param {string} [environmentName=null]
     * @param {Object} [sensitive={}]
     * @param {string[]} [sensitive.headerNames]
     * @param {string[]} [sensitive.queryNames]
     * @returns {Promise<Object>}
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
     * @param {Object} headers
     * @param {ReadonlyArray<string>} baseNames
     * @param {string[]} [extraNames=[]]
     * @returns {Object}
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
     * @param {string} url
     * @param {string[]} [queryNames=[]]
     * @returns {string}
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

    /** @returns {Promise<Array<Object>>} */
    async getAllHistory() {
        return this.repository.getAll();
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getHistoryById(id) {
        return this.repository.getById(id);
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteHistoryEntry(id) {
        return this.repository.delete(id);
    }

    /** @returns {Promise<void>} */
    async clearAllHistory() {
        return this.repository.clear();
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async getHistoryByCollection(collectionId) {
        return this.repository.getByCollection(collectionId);
    }

    /**
     * @param {string} searchTerm
     * @returns {Promise<Array<Object>>}
     */
    async searchHistory(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            return this.getAllHistory();
        }
        return this.repository.search(searchTerm);
    }

    /**
     * @param {number} timestamp
     * @returns {string}
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
     * @param {number} status
     * @returns {string}
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
     * @param {string} method
     * @returns {string}
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
     * @param {Object} entry
     * @returns {{text: string, color: string}|null}
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
     * @param {string} url
     * @param {number} [maxLength=50]
     * @returns {string}
     */
    truncateUrl(url, maxLength = 50) {
        if (url.length <= maxLength) {return url;}
        return `${url.substring(0, maxLength - 3)  }...`;
    }
}
