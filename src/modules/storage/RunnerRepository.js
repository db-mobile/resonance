/**
 * @fileoverview Repository for managing collection runner data persistence
 * @module storage/RunnerRepository
 */

/** @type {RunnerRepository|null} */
let sharedRepository = null;

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

    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.RUNNERS_KEY = 'collectionRunners';
        this._cache = null;
        this._writeQueue = Promise.resolve();
    }

    /** @returns {Promise<Array<Object>>} */
    async getAll() {
        return clone(await this._load());
    }

    /** @returns {Promise<Array<Object>>} */
    async _load() {
        if (this._cache !== null) {
            return this._cache;
        }

        try {
            const runners = await this.backendAPI.store.get(this.RUNNERS_KEY);

            if (!Array.isArray(runners)) {
                await this.backendAPI.store.set(this.RUNNERS_KEY, []);
                this._cache = [];
                return this._cache;
            }

            this._cache = runners;
            return runners;
        } catch (error) {
            return [];
        }
    }

    /**
     * @param {Array<Object>} runners
     * @returns {Promise<void>}
     */
    async save(runners) {
        try {
            await this.backendAPI.store.set(this.RUNNERS_KEY, runners);
            this._cache = clone(runners);
        } catch (error) {
            throw new Error(`Failed to save runners: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {function(Array<Object>): Promise<*>} mutate
     * @returns {Promise<*>}
     */
    _write(mutate) {
        const run = this._writeQueue.then(async () => mutate(clone(await this._load())));
        this._writeQueue = run.catch(() => {});
        return run;
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async getById(id) {
        const runners = await this.getAll();
        return runners.find(runner => runner.id === id);
    }

    /**
     * @param {Object} runner
     * @param {string} runner.name
     * @param {string} runner.collectionId
     * @param {Array<Object>} runner.requests
     * @returns {Promise<Object>}
     */
    async add(runner) {
        return this._write(async (runners) => {
            const newRunner = {
                id: this._generateId(),
                name: runner.name || 'Untitled Runner',
                collectionId: runner.collectionId || null,
                requests: runner.requests || [],
                overridesVersion: runner.overridesVersion ?? null,
                options: {
                    stopOnError: true,
                    delayMs: 0,
                    ...runner.options
                },
                createdAt: Date.now(),
                lastModifiedAt: Date.now(),
                lastRunAt: null
            };

            runners.push(newRunner);
            await this.save(runners);
            return clone(newRunner);
        });
    }

    /**
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async update(id, updates) {
        return this._write(async (runners) => {
            const index = runners.findIndex(runner => runner.id === id);

            if (index === -1) {
                return null;
            }

            runners[index] = {
                ...runners[index],
                ...clone(updates),
                lastModifiedAt: Date.now()
            };

            await this.save(runners);
            return clone(runners[index]);
        });
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        return this._write(async (runners) => {
            const updatedRunners = runners.filter(runner => runner.id !== id);

            if (updatedRunners.length === runners.length) {
                return false;
            }

            await this.save(updatedRunners);
            return true;
        });
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Array<Object>>}
     */
    async getByCollectionId(collectionId) {
        const runners = await this.getAll();
        return runners.filter(runner => runner.collectionId === collectionId);
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async updateLastRun(id) {
        return this.update(id, { lastRunAt: Date.now() });
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async duplicate(id) {
        const runner = await this.getById(id);
        if (!runner) {
            return null;
        }

        const duplicatedRunner = {
            ...runner,
            id: undefined,
            name: `${runner.name} (Copy)`,
            createdAt: undefined,
            lastModifiedAt: undefined,
            lastRunAt: null
        };

        return this.add(duplicatedRunner);
    }

    /** @returns {string} */
    _generateId() {
        return `runner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
}

/**
 * @param {*} value
 * @returns {*}
 */
function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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
 * @property {string} name
 * @property {string|null} collectionId
 * @property {Array<RunnerRequest>} requests
 * @property {number|null} overridesVersion
 * @property {Object} options
 * @property {boolean} options.stopOnError
 * @property {number} options.delayMs
 * @property {number} createdAt
 * @property {number} lastModifiedAt
 * @property {number|null} lastRunAt
 */
