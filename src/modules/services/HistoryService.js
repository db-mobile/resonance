import { HistoryRepository } from '../storage/HistoryRepository.js';

export class HistoryService {
    constructor(electronAPI) {
        this.repository = new HistoryRepository(electronAPI);
    }

    generateId() {
        return `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

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

        return await this.repository.add(historyEntry);
    }

    async getAllHistory() {
        return await this.repository.getAll();
    }

    async getHistoryById(id) {
        return await this.repository.getById(id);
    }

    async deleteHistoryEntry(id) {
        return await this.repository.delete(id);
    }

    async clearAllHistory() {
        return await this.repository.clear();
    }

    async getHistoryByCollection(collectionId) {
        return await this.repository.getByCollection(collectionId);
    }

    async searchHistory(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            return await this.getAllHistory();
        }
        return await this.repository.search(searchTerm);
    }

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
        } else {
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }
    }

    getStatusColor(status) {
        if (!status) return 'var(--text-secondary)';
        if (status >= 200 && status < 300) return 'var(--success-color, #10b981)';
        if (status >= 300 && status < 400) return 'var(--warning-color, #f59e0b)';
        if (status >= 400 && status < 500) return 'var(--error-color, #ef4444)';
        if (status >= 500) return 'var(--error-color, #dc2626)';
        return 'var(--text-secondary)';
    }

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

    truncateUrl(url, maxLength = 50) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }
}
