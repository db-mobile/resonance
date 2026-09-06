/**
 * @fileoverview Repository for managing collection runner data persistence
 * @module storage/RunnerRepository
 */

export class RunnerRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.RUNNERS_KEY = 'collectionRunners';
        this._cache = null;
    }

    /** @returns {Promise<Array<Object>>} */
    async getAll() {
        if (this._cache !== null) {
            return this._cache;
        }

        try {
            const runners = await this.backendAPI.store.get(this.RUNNERS_KEY);

            if (!Array.isArray(runners)) {
                await this.backendAPI.store.set(this.RUNNERS_KEY, []);
                this._cache = [];
                return [];
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
            this._cache = runners;
            await this.backendAPI.store.set(this.RUNNERS_KEY, runners);
        } catch (error) {
            throw new Error(`Failed to save runners: ${error.message}`, { cause: error });
        }
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
        const runners = await this.getAll();

        const newRunner = {
            id: this._generateId(),
            name: runner.name || 'Untitled Runner',
            collectionId: runner.collectionId || null,
            requests: runner.requests || [],
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
        return newRunner;
    }

    /**
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async update(id, updates) {
        const runners = await this.getAll();
        const index = runners.findIndex(runner => runner.id === id);

        if (index === -1) {
            return null;
        }

        runners[index] = {
            ...runners[index],
            ...updates,
            lastModifiedAt: Date.now()
        };

        await this.save(runners);
        return runners[index];
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        const runners = await this.getAll();
        const updatedRunners = runners.filter(runner => runner.id !== id);

        if (updatedRunners.length === runners.length) {
            return false;
        }

        await this.save(updatedRunners);
        return true;
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
 * @property {Object} options
 * @property {boolean} options.stopOnError
 * @property {number} options.delayMs
 * @property {number} createdAt
 * @property {number} lastModifiedAt
 * @property {number|null} lastRunAt
 */
