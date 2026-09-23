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
 * @param {Object} entry
 * @returns {number}
 */
function serializedSize(entry) {
    return JSON.stringify(entry)?.length || 0;
}

/**
 * @param {Array<Object>} entries
 * @param {number} budget
 * @param {function(Object): number} [sizeOf]
 * @returns {Array<Object>}
 */
export function fitHistoryToBudget(entries, budget, sizeOf = serializedSize) {
    let total = 0;

    for (let index = 0; index < entries.length; index += 1) {
        total += sizeOf(entries[index]);
        if (total > budget) {
            return entries.slice(0, Math.max(1, index));
        }
    }

    return entries;
}

/** @type {HistoryRepository|null} */
let sharedRepository = null;

export class HistoryRepository {
    /**
     * @param {Object} backendAPI
     * @returns {HistoryRepository}
     */
    static shared(backendAPI) {
        if (!sharedRepository || sharedRepository.backendAPI !== backendAPI) {
            sharedRepository = new HistoryRepository(backendAPI);
        }
        return sharedRepository;
    }

    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.HISTORY_KEY = 'requestHistory';
        this.MAX_HISTORY_ITEMS = 100;
        /** @type {Array<Object>|null} */
        this._entries = null;
        /** @type {WeakMap<Object, number>} */
        this._sizes = new WeakMap();
        this._writeQueue = Promise.resolve();
    }

    /**
     * @param {Object} entry
     * @returns {number}
     */
    _sizeOf(entry) {
        let size = this._sizes.get(entry);
        if (size === undefined) {
            size = serializedSize(entry);
            this._sizes.set(entry, size);
        }
        return size;
    }

    /** @returns {Promise<Array<Object>>} */
    async _load() {
        if (this._entries === null) {
            let data = await this.backendAPI.store.get(this.HISTORY_KEY);
            if (!Array.isArray(data)) {
                data = [];
                await this.backendAPI.store.set(this.HISTORY_KEY, data).catch(() => {});
            }
            this._entries = data
                .map(capHistoryEntry)
                .sort((a, b) => b.timestamp - a.timestamp);
        }
        return this._entries;
    }

    /**
     * @param {function(Array<Object>): Promise<Array<Object>>|Array<Object>} mutate
     * @returns {Promise<void>}
     */
    _write(mutate) {
        const run = this._writeQueue.then(async () => {
            const next = await mutate([...await this._load()]);
            await this.backendAPI.store.set(this.HISTORY_KEY, next);
            this._entries = next;
        });
        this._writeQueue = run.catch(() => {});
        return run;
    }

    /** @returns {Promise<number>} */
    async _maxItems() {
        try {
            const settings = await this.backendAPI.settings.get();
            if (typeof settings.historyLimit === 'number' && settings.historyLimit >= 10) {
                return settings.historyLimit;
            }
        } catch (e) {
            void e;
        }
        return this.MAX_HISTORY_ITEMS;
    }

    /** @returns {Promise<Array<Object>>} */
    async getAll() {
        await this._writeQueue;
        try {
            return [...await this._load()];
        } catch (error) {
            void error;
            return [];
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
            await this._write(async (history) => {
                const maxItems = await this._maxItems();
                const next = [capHistoryEntry(historyEntry), ...history].slice(0, maxItems);
                return fitHistoryToBudget(next, MAX_HISTORY_TOTAL_BYTES, (entry) => this._sizeOf(entry));
            });
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
            await this._write((history) => history.filter(entry => entry.id !== id));
            return true;
        } catch (error) {
            throw new Error(`Failed to delete history entry: ${error.message}`, { cause: error });
        }
    }

    /** @returns {Promise<boolean>} */
    async clear() {
        try {
            await this._write(() => []);
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
