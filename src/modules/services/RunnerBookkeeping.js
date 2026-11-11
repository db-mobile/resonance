/**
 * @fileoverview Desktop-local runner state that outlives any runner tab: per-collection cleanup
 * @module services/RunnerBookkeeping
 */

export class RunnerBookkeeping {
    /**
     * @param {Object} deps
     * @param {Object} deps.repository
     * @param {Object} deps.historyRepository
     */
    constructor({ repository, historyRepository }) {
        this.repository = repository;
        this.historyRepository = historyRepository;
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<void>}
     */
    async forgetCollection(collectionId) {
        const ids = (await this.repository.getAllByCollection(collectionId)).map(runner => runner.id);
        if (ids.length > 0) {
            await this.repository.removeLastRuns(ids);
            await this.historyRepository.removeMany(ids);
        }
        this.repository.invalidate(collectionId);
    }
}
