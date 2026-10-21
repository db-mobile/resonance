/**
 * @fileoverview Repository for collection runners stored as files inside each collection
 * @module storage/RunnerRepository
 */

import { clone } from '../utils/clone.js';
import { fromRunnerDoc, toRunnerDoc } from './runnerDoc.js';

/** @type {RunnerRepository|null} */
let sharedRepository = null;

export const LAST_RUNS_KEY = 'runnerLastRuns';

export class RunnerRepository {
    /**
     * @param {Object} backendAPI
     * @returns {RunnerRepository}
     */
    static shared(backendAPI) {
        if (!sharedRepository || sharedRepository.backendAPI !== backendAPI) {
            sharedRepository = new RunnerRepository(backendAPI);
        }
        return sharedRepository;
    }

    /**
     * @param {Object} backendAPI
     * @param {{listCollectionIds?: () => Promise<Array<string>>}} [deps]
     */
    constructor(backendAPI, { listCollectionIds = null } = {}) {
        this.backendAPI = backendAPI;
        this._listCollectionIds = listCollectionIds || (() => backendAPI.collections.list());
        this._byCollection = new Map();
        this._lastRuns = null;
        this._writeQueue = Promise.resolve();
    }

    /** @param {string|null} [collectionId] */
    invalidate(collectionId = null) {
        if (collectionId) {
            this._byCollection.delete(collectionId);
            return;
        }
        this._byCollection.clear();
        this._lastRuns = null;
    }

    /**
     * @param {{fresh?: boolean}} [options]
     * @returns {Promise<Array<Object>>}
     */
    async getAll({ fresh = false } = {}) {
        if (fresh) {
            this.invalidate();
        }
        let collectionIds;
        try {
            collectionIds = (await this._listCollectionIds()) || [];
        } catch {
            return [];
        }
        const lists = await Promise.all(collectionIds.map(id => this.getAllByCollection(id)));
        return lists.flat();
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async getAllByCollection(collectionId) {
        return clone(await this._loadCollection(collectionId));
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async _loadCollection(collectionId) {
        if (this._byCollection.has(collectionId)) {
            return this._byCollection.get(collectionId);
        }
        try {
            const [docs, lastRuns] = await Promise.all([
                this.backendAPI.collections.runners.list(collectionId),
                this._loadLastRuns()
            ]);
            const runners = (docs || []).map(doc => fromRunnerDoc(collectionId, doc, lastRuns[doc.id] ?? null));
            this._byCollection.set(collectionId, runners);
            return runners;
        } catch {
            return [];
        }
    }

    /** @returns {Promise<Object<string, number>>} */
    async _loadLastRuns() {
        if (this._lastRuns === null) {
            try {
                const stored = await this.backendAPI.store.get(LAST_RUNS_KEY);
                this._lastRuns = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
            } catch {
                return {};
            }
        }
        return this._lastRuns;
    }

    /**
     * @param {function(): Promise<*>} work
     * @returns {Promise<*>}
     */
    _queued(work) {
        const run = this._writeQueue.then(work);
        this._writeQueue = run.catch(() => {});
        return run;
    }

    /**
     * @param {string} collectionId
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async getById(collectionId, id) {
        const runners = await this.getAllByCollection(collectionId);
        return runners.find(runner => runner.id === id);
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async findById(id) {
        const runners = await this.getAll();
        return runners.find(runner => runner.id === id);
    }

    /**
     * @param {string} collectionId
     * @param {Object} runnerData
     * @returns {Promise<Object>}
     */
    async add(collectionId, runnerData) {
        return this._save(collectionId, toRunnerDoc({ ...runnerData, id: '' }));
    }

    /**
     * @param {string} collectionId
     * @param {Object} runner
     * @returns {Promise<Object>}
     */
    async put(collectionId, runner) {
        return this._save(collectionId, toRunnerDoc(runner));
    }

    /**
     * @param {string} collectionId
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async update(collectionId, id, updates) {
        const current = await this.getById(collectionId, id);
        if (!current) {
            return null;
        }
        return this._save(collectionId, toRunnerDoc({ ...current, ...clone(updates), id }));
    }

    /**
     * @param {string} collectionId
     * @param {Object} doc
     * @returns {Promise<Object>}
     */
    _save(collectionId, doc) {
        return this._queued(async () => {
            let stored;
            try {
                stored = await this.backendAPI.collections.runners.save(collectionId, doc);
            } catch (error) {
                throw new Error(`Failed to save runner: ${error?.message || String(error)}`, { cause: error });
            }
            const lastRuns = await this._loadLastRuns();
            const runner = fromRunnerDoc(collectionId, stored, lastRuns[stored.id] ?? null);
            const runners = await this._loadCollection(collectionId);
            const index = runners.findIndex(existing => existing.id === runner.id);
            if (index === -1) {
                runners.push(runner);
            } else {
                runners[index] = runner;
            }
            this._byCollection.set(collectionId, runners);
            return clone(runner);
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(collectionId, id) {
        const removed = await this._queued(async () => {
            const result = await this.backendAPI.collections.runners.delete(collectionId, id);
            if (this._byCollection.has(collectionId)) {
                this._byCollection.set(collectionId, this._byCollection.get(collectionId).filter(runner => runner.id !== id));
            }
            return Boolean(result);
        });
        await this.removeLastRuns([id]);
        return removed;
    }

    /**
     * @param {string} id
     * @returns {Promise<void>}
     */
    updateLastRun(id) {
        return this.mergeLastRuns({ [id]: Date.now() });
    }

    /**
     * @param {Object<string, number>} entries
     * @returns {Promise<void>}
     */
    mergeLastRuns(entries) {
        return this._queued(async () => {
            const lastRuns = clone(await this._loadLastRuns());
            let changed = false;
            for (const [id, timestamp] of Object.entries(entries || {})) {
                if (typeof timestamp === 'number' && (lastRuns[id] ?? 0) < timestamp) {
                    lastRuns[id] = timestamp;
                    changed = true;
                }
            }
            if (!changed) {
                return;
            }
            await this.backendAPI.store.set(LAST_RUNS_KEY, lastRuns);
            this._lastRuns = lastRuns;
            this._applyLastRuns(lastRuns);
        });
    }

    /**
     * @param {Array<string>} ids
     * @returns {Promise<void>}
     */
    removeLastRuns(ids) {
        return this._queued(async () => {
            const lastRuns = clone(await this._loadLastRuns());
            const present = (ids || []).filter(id => id in lastRuns);
            if (present.length === 0) {
                return;
            }
            for (const id of present) {
                delete lastRuns[id];
            }
            await this.backendAPI.store.set(LAST_RUNS_KEY, lastRuns);
            this._lastRuns = lastRuns;
            this._applyLastRuns(lastRuns);
        });
    }

    /** @param {Object<string, number>} lastRuns */
    _applyLastRuns(lastRuns) {
        for (const runners of this._byCollection.values()) {
            for (const runner of runners) {
                runner.lastRunAt = lastRuns[runner.id] ?? null;
            }
        }
    }
}

/**
 * @typedef {Object} RunnerRequest
 * @property {string} collectionId
 * @property {string} endpointId
 * @property {string} name
 * @property {string} method
 * @property {string} path
 * @property {string} postResponseScript
 * @property {Object} [overrides]
 * @property {Array<{key: string, value: string}>} [overrides.pathParams]
 * @property {Array<{key: string, value: string}>} [overrides.queryParams]
 * @property {Array<{key: string, value: string}>} [overrides.headers]
 * @property {string} [overrides.body]
 */

/**
 * @typedef {Object} Runner
 * @property {string} id
 * @property {string} collectionId
 * @property {string} name
 * @property {number} seq
 * @property {Array<RunnerRequest>} requests
 * @property {Object} options
 * @property {boolean} options.stopOnError
 * @property {number} options.delayMs
 * @property {number} options.iterations
 * @property {number} [options.maxExecutionsPerIteration]
 * @property {{path: string, name: string}|null} options.dataFile
 * @property {number|null} lastRunAt
 */
