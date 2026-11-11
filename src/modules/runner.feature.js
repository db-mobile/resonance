/**
 * @fileoverview Feature descriptor wiring the runner repositories and their bookkeeping
 * @module runner.feature
 */

import { RunnerRepository } from './storage/RunnerRepository.js';
import { RunnerHistoryRepository } from './storage/RunnerHistoryRepository.js';
import { RunnerBookkeeping } from './services/RunnerBookkeeping.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const runnerFeature = {
    name: 'runner',
    create(ctx) {
        const repository = RunnerRepository.shared(ctx.backendAPI);
        const historyRepository = RunnerHistoryRepository.shared(ctx.backendAPI);
        const bookkeeping = new RunnerBookkeeping({ repository, historyRepository });
        return { repository, historyRepository, bookkeeping };
    },
    globals: { runnerBookkeeping: 'bookkeeping' },
    init({ repository }, ctx) {
        const collectionController = ctx.get('collectionController');
        collectionController?.onCollectionsLoaded(() => repository.invalidate());
        window.addEventListener('focus', () => repository.invalidate());
    }
};
