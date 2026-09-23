/**
 * @fileoverview Per-runner history of past collection-runner runs, newest first
 * @module storage/RunnerHistoryRepository
 */

export const MAX_RUNS_PER_RUNNER = 20;

/** @type {RunnerHistoryRepository|null} */
let sharedRepository = null;

/**
 * @param {*} value
 * @returns {*}
 */
function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export class RunnerHistoryRepository {
    /**
     * @param {Object} backendAPI
     * @returns {RunnerHistoryRepository}
     */
    static shared(backendAPI) {
        if (!sharedRepository || sharedRepository.backendAPI !== backendAPI) {
            sharedRepository = new RunnerHistoryRepository(backendAPI);
        }
        return sharedRepository;
    }

    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.KEY = 'runnerRunHistory';
        this._cache = null;
        this._writeQueue = Promise.resolve();
    }

    /** @returns {Promise<Object<string, Array<Object>>>} */
    async _load() {
        if (this._cache === null) {
            try {
                const stored = await this.backendAPI.store.get(this.KEY);
                this._cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
            } catch (error) {
                void error;
                return {};
            }
        }
        return this._cache;
    }

    /**
     * @param {function(Object<string, Array<Object>>): *} mutate
     * @returns {Promise<*>}
     */
    _write(mutate) {
        const run = this._writeQueue.then(async () => {
            const history = clone(await this._load());
            const result = mutate(history);
            await this.backendAPI.store.set(this.KEY, history);
            this._cache = history;
            return result;
        });
        this._writeQueue = run.catch(() => {});
        return run;
    }

    /**
     * @param {string} runnerId
     * @returns {Promise<Array<Object>>}
     */
    async list(runnerId) {
        return clone((await this._load())[runnerId] || []);
    }

    /**
     * @param {string} runnerId
     * @param {Object} summary
     * @returns {Promise<void>}
     */
    record(runnerId, summary) {
        return this._write((history) => {
            history[runnerId] = [clone(summary), ...(history[runnerId] || [])].slice(0, MAX_RUNS_PER_RUNNER);
        });
    }

    /**
     * @param {string} runnerId
     * @returns {Promise<void>}
     */
    remove(runnerId) {
        return this._write((history) => {
            delete history[runnerId];
        });
    }
}
