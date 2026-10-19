/**
 * @fileoverview Desktop-local runner state that outlives any runner tab: the store migration and per-collection cleanup
 * @module services/RunnerBookkeeping
 */

import { toast } from '../ui/Toast.js';
import { translateCount } from '../utils/translate.js';
import { migrateLegacyRunners } from '../storage/runnerMigration.js';
import { loadEndpointRequestConfig } from './endpointRequestConfig.js';

export class RunnerBookkeeping {
    /**
     * @param {Object} deps
     * @param {Object} deps.backendAPI
     * @param {Object} deps.repository
     * @param {Object} deps.historyRepository
     */
    constructor({ backendAPI, repository, historyRepository }) {
        this.backendAPI = backendAPI;
        this.repository = repository;
        this.historyRepository = historyRepository;
        this._pass = null;
        this._announcedSkipped = false;
    }

    /**
     * @param {Array<Object>} collections
     * @param {Object} collectionRepository
     * @returns {Promise<Object|null>}
     */
    runMigrationPass(collections, collectionRepository) {
        if (this._pass) {
            return this._pass;
        }
        this._pass = migrateLegacyRunners({
            backendAPI: this.backendAPI,
            repository: this.repository,
            collections,
            resolveDefaults: (collectionId, endpointId) =>
                loadEndpointRequestConfig(collectionRepository, collectionId, endpointId)
        })
            .then((summary) => {
                this._announce(summary);
                return summary;
            })
            .catch(() => null)
            .finally(() => {
                this._pass = null;
            });
        return this._pass;
    }

    /** @param {{moved: Array, dropped: Array, skipped: Array}} summary */
    _announce(summary) {
        if (summary.moved.length > 0) {
            toast.success(translateCount('runner.migration_moved', summary.moved.length, {
                one: 'Moved {{count}} saved runner into its collection folder',
                other: 'Moved {{count}} saved runners into their collection folders'
            }));
        }
        if (summary.dropped.length > 0) {
            toast.warning(translateCount('runner.migration_dropped', summary.dropped.length, {
                one: '{{count}} runner lost requests from other collections: {{names}}',
                other: '{{count}} runners lost requests from other collections: {{names}}'
            }, { names: summary.dropped.map(entry => entry.name).join(', ') }));
        }
        if (summary.skipped.length > 0 && !this._announcedSkipped) {
            this._announcedSkipped = true;
            toast.info(translateCount('runner.migration_skipped', summary.skipped.length, {
                one: '{{count}} saved runner has no requests and was not moved',
                other: '{{count}} saved runners have no requests and were not moved'
            }));
        }
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
