/**
 * @fileoverview Repository for managing request history persistence
 * @module storage/HistoryRepository
 */

import { truncateBody } from '../utils/truncateBody.js';

/** @type {number} */
export const MAX_HISTORY_RESPONSE_SIZE = 64 * 1024;

/** @type {number} */
export const MAX_HISTORY_REQUEST_SIZE = 256 * 1024;

/** @type {number} */
export const MAX_HISTORY_TOTAL_BYTES = 5 * 1024 * 1024;

/**
 * @param {Object} entry
 * @returns {Object}
 */
export function capHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return entry;
    }

    const { request, response } = entry;
    const cappedRequest = request
        ? truncateBody(request.body ?? null, MAX_HISTORY_REQUEST_SIZE)
        : null;
    const cappedResponse = response
        ? truncateBody(response.data ?? null, MAX_HISTORY_RESPONSE_SIZE)
        : null;

    if (!cappedRequest?.truncated && !cappedResponse?.truncated) {
        return entry;
    }

    const capped = { ...entry };

    if (cappedRequest?.truncated) {
        capped.request = {
            ...request,
            body: cappedRequest.value,
            truncated: true,
            originalSize: cappedRequest.originalSize
        };
    }

    if (cappedResponse?.truncated) {
        capped.response = {
            ...response,
            data: cappedResponse.value,
            truncated: true,
            originalSize: cappedResponse.originalSize
        };
    }

    return capped;
}

/**
 * @param {Array<Object>} entries
 * @param {number} budget
 * @returns {Array<Object>}
 */
export function fitHistoryToBudget(entries, budget) {
    let total = 0;

    for (let index = 0; index < entries.length; index += 1) {
        total += JSON.stringify(entries[index])?.length || 0;
        if (total > budget) {
            return entries.slice(0, Math.max(1, index));
        }
    }

    return entries;
}

export class HistoryRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.HISTORY_KEY = 'requestHistory';
        this.MAX_HISTORY_ITEMS = 100;
    }

    /**
     * @param {string} key
     * @param {Array} [defaultValue=[]]
     * @returns {Promise<Array>}
     */
    async _getArrayFromStore(key, defaultValue = []) {
        try {
            let data = await this.backendAPI.store.get(key);

            if (!Array.isArray(data)) {
                data = defaultValue;
                await this.backendAPI.store.set(key, data);
            }

            return data;
        } catch (error) {
            return defaultValue;
        }
    }

    /** @returns {Promise<Array<Object>>} */
    async getAll() {
        try {
            const history = await this._getArrayFromStore(this.HISTORY_KEY);
            return history
                .map(capHistoryEntry)
                .sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            throw new Error(`Failed to load history: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} historyEntry
     * @param {string} historyEntry.id
     * @param {number} historyEntry.timestamp
     * @param {Object} historyEntry.request
     * @param {Object} historyEntry.response
     * @returns {Promise<Object>}
     */
    async add(historyEntry) {
        try {
            let history = await this._getArrayFromStore(this.HISTORY_KEY);

            if (!Array.isArray(history)) {
                history = [];
            }

            history.unshift(historyEntry);
            history = history.map(capHistoryEntry);

            let maxItems = this.MAX_HISTORY_ITEMS;
            try {
                const settings = await this.backendAPI.settings.get();
                if (typeof settings.historyLimit === 'number' && settings.historyLimit >= 10) {
                    maxItems = settings.historyLimit;
                }
            } catch (e) {
                void e;
            }
            if (history.length > maxItems) {
                history = history.slice(0, maxItems);
            }

            history = fitHistoryToBudget(history, MAX_HISTORY_TOTAL_BYTES);

            await this.backendAPI.store.set(this.HISTORY_KEY, history);
            return historyEntry;
        } catch (error) {
            throw new Error(`Failed to add history entry: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getById(id) {
        try {
            const history = await this.getAll();
            return history.find(entry => entry.id === id);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        try {
            const history = await this._getArrayFromStore(this.HISTORY_KEY);
            const updatedHistory = history.filter(entry => entry.id !== id);
            await this.backendAPI.store.set(this.HISTORY_KEY, updatedHistory);
            return true;
        } catch (error) {
            throw new Error(`Failed to delete history entry: ${error.message}`, { cause: error });
        }
    }

    /** @returns {Promise<boolean>} */
    async clear() {
        try {
            await this.backendAPI.store.set(this.HISTORY_KEY, []);
            return true;
        } catch (error) {
            throw new Error(`Failed to clear history: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async getByCollection(collectionId) {
        try {
            const history = await this.getAll();
            return history.filter(entry =>
                entry.request.collectionId === collectionId
            );
        } catch (error) {
            return [];
        }
    }

    /**
     * @param {string} searchTerm
     * @returns {Promise<Array<Object>>}
     */
    async search(searchTerm) {
        try {
            const history = await this.getAll();
            const lowerSearchTerm = searchTerm.toLowerCase();

            return history.filter(entry => {
                const urlMatch = entry.request.url.toLowerCase().includes(lowerSearchTerm);
                const methodMatch = entry.request.method.toLowerCase().includes(lowerSearchTerm);
                const statusMatch = entry.response?.status?.toString().includes(lowerSearchTerm);

                return urlMatch || methodMatch || statusMatch;
            });
        } catch (error) {
            return [];
        }
    }
}
