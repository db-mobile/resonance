/**
 * @fileoverview Repository for managing collection runner data persistence
 * @module storage/RunnerRepository
 */

/**
 * Repository for managing collection runner data persistence
 *
 * @class
 * @classdesc Handles all CRUD operations for collection runners in the persistent store.
 * Runners define sequences of requests to execute with post-response scripts for
 * variable chaining between requests.
 */
export class RunnerRepository {
    /**
     * Creates a RunnerRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.RUNNERS_KEY = 'collectionRunners';
    }

    /**
     * Retrieves all runners from storage
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of runner objects
     */
    async getAll() {
        try {
            const runners = await this.backendAPI.store.get(this.RUNNERS_KEY);

            if (!Array.isArray(runners)) {
                await this.backendAPI.store.set(this.RUNNERS_KEY, []);
                return [];
            }

            return runners;
        } catch (error) {
            return [];
        }
    }

    /**
     * Saves runners array to storage
     *
     * @async
     * @param {Array<Object>} runners - Array of runner objects to save
     * @returns {Promise<void>}
     * @throws {Error} If storage write fails
     */
    async save(runners) {
        try {
            await this.backendAPI.store.set(this.RUNNERS_KEY, runners);
        } catch (error) {
            throw new Error(`Failed to save runners: ${error.message}`);
        }
    }

    /**
     * Retrieves a runner by its ID
     *
     * @async
     * @param {string} id - The runner ID
     * @returns {Promise<Object|undefined>} The runner object or undefined if not found
     */
    async getById(id) {
        const runners = await this.getAll();
        return runners.find(runner => runner.id === id);
    }

    /**
     * Adds a new runner to storage
     *
     * @async
     * @param {Object} runner - The runner object to add
     * @param {string} runner.name - Runner name
     * @param {string} runner.collectionId - Source collection ID
     * @param {Array<Object>} runner.requests - Array of request configurations
     * @returns {Promise<Object>} The added runner object with generated ID
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
     * Updates an existing runner
     *
     * @async
     * @param {string} id - The runner ID to update
     * @param {Object} updates - Object with properties to update
     * @returns {Promise<Object|null>} The updated runner object or null if not found
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
     * Deletes a runner by ID
     *
     * @async
     * @param {string} id - The runner ID to delete
     * @returns {Promise<boolean>} True if deletion succeeded
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
     * Gets all runners for a specific collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Array<Object>>} Array of runner objects for the collection
     */
    async getByCollectionId(collectionId) {
        const runners = await this.getAll();
        return runners.filter(runner => runner.collectionId === collectionId);
    }

    /**
     * Updates the last run timestamp for a runner
     *
     * @async
     * @param {string} id - The runner ID
     * @returns {Promise<Object|null>} The updated runner or null if not found
     */
    async updateLastRun(id) {
        return this.update(id, { lastRunAt: Date.now() });
    }

    /**
     * Duplicates an existing runner
     *
     * @async
     * @param {string} id - The runner ID to duplicate
     * @returns {Promise<Object|null>} The duplicated runner or null if source not found
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

    /**
     * Generates a unique runner ID
     *
     * @private
     * @returns {string} A unique runner identifier
     */
    _generateId() {
        return `runner_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
}

/**
 * Runner request configuration schema
 * @typedef {Object} RunnerRequest
 * @property {string} collectionId - The collection containing the endpoint
 * @property {string} endpointId - The endpoint ID to execute
 * @property {string} name - Display name for the request
 * @property {string} method - HTTP method
 * @property {string} path - Request path
 * @property {string} postResponseScript - Script to execute after response
 */

/**
 * Runner configuration schema
 * @typedef {Object} Runner
 * @property {string} id - Unique runner identifier
 * @property {string} name - User-defined runner name
 * @property {string|null} collectionId - Primary collection ID (for display)
 * @property {Array<RunnerRequest>} requests - Ordered list of requests to execute
 * @property {Object} options - Runner options
 * @property {boolean} options.stopOnError - Stop execution on first error
 * @property {number} options.delayMs - Delay between requests in milliseconds
 * @property {number} createdAt - Creation timestamp
 * @property {number} lastModifiedAt - Last modification timestamp
 * @property {number|null} lastRunAt - Last execution timestamp
 */
