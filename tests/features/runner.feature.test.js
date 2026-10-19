/* global window */
import { runnerFeature } from '../../src/modules/runner.feature.js';
import { RunnerRepository } from '../../src/modules/storage/RunnerRepository.js';
import { RunnerBookkeeping } from '../../src/modules/services/RunnerBookkeeping.js';

function makeContext() {
    const shared = new Map();
    const listeners = [];
    shared.set('collectionController', { onCollectionsLoaded: jest.fn((listener) => { listeners.push(listener); return () => {}; }) });
    shared.set('collectionRepository', { marker: 'collections' });
    return {
        ctx: {
            backendAPI: { collections: { list: jest.fn().mockResolvedValue([]), runners: {} }, store: { get: jest.fn().mockResolvedValue(null), set: jest.fn() } },
            _shared: shared,
            provide(name, value) { shared.set(name, value); return value; },
            get(name) { return shared.get(name); }
        },
        listeners
    };
}

describe('runner feature', () => {
    test('builds the shared repositories and the bookkeeping service', () => {
        const { ctx } = makeContext();

        const instances = runnerFeature.create(ctx);

        expect(instances.repository).toBe(RunnerRepository.shared(ctx.backendAPI));
        expect(instances.bookkeeping).toBeInstanceOf(RunnerBookkeeping);
        expect(runnerFeature.globals).toEqual({ runnerBookkeeping: 'bookkeeping' });
    });

    test('init invalidates the cache and runs a migration pass whenever collections load, and on focus', () => {
        const { ctx, listeners } = makeContext();
        const instances = runnerFeature.create(ctx);
        instances.repository.invalidate = jest.fn();
        instances.bookkeeping.runMigrationPass = jest.fn().mockResolvedValue(null);

        runnerFeature.init(instances, ctx);
        listeners[0]([{ id: 'c1' }]);
        window.dispatchEvent(new window.Event('focus'));

        expect(instances.repository.invalidate).toHaveBeenCalledTimes(2);
        expect(instances.bookkeeping.runMigrationPass).toHaveBeenCalledWith([{ id: 'c1' }], ctx.get('collectionRepository'));
    });
});
