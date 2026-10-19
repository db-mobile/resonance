import {
    migrateLegacyRunners,
    convertLegacyRunner,
    ownerCollectionId,
    LEGACY_RUNNERS_KEY,
    LEGACY_BACKUP_KEY,
    MIGRATED_COLLECTIONS_KEY
} from '../../src/modules/storage/runnerMigration.js';

function legacyRunner(id, requests, extra = {}) {
    return { id, name: id.toUpperCase(), overridesVersion: 2, options: { stopOnError: true, delayMs: 0 }, requests, lastRunAt: null, ...extra };
}

function entry(collectionId, endpointId, overrides = {}) {
    return { collectionId, endpointId, name: endpointId, method: 'GET', path: `/${endpointId}`, postResponseScript: '', overrides };
}

function setup(legacy, { collections = [{ id: 'c1', name: 'One', storagePath: '/work/one' }, { id: 'c2', name: 'Two', storagePath: '/work/two' }], existing = {} } = {}) {
    const store = { [LEGACY_RUNNERS_KEY]: legacy };
    const backendAPI = {
        store: {
            get: jest.fn(async (key) => store[key] ?? null),
            set: jest.fn(async (key, value) => { store[key] = value; })
        }
    };
    const saved = [];
    const lastRuns = [];
    const repository = {
        getAllByCollection: jest.fn(async (collectionId) => (existing[collectionId] || []).map(id => ({ id }))),
        put: jest.fn(async (collectionId, runner) => { saved.push({ collectionId, runner }); return runner; }),
        mergeLastRuns: jest.fn(async (entries) => { lastRuns.push(entries); })
    };
    const resolveDefaults = jest.fn(async () => ({ pathParams: [], queryParams: [{ key: 'page', value: '1', enabled: true }], headers: [], body: '' }));
    const run = () => migrateLegacyRunners({ backendAPI, repository, collections, resolveDefaults });
    return { store, backendAPI, repository, saved, lastRuns, resolveDefaults, run };
}

describe('runnerMigration', () => {
    test('moves a legacy runner under the collection of its first request with its id preserved', async () => {
        const { run, saved, store } = setup([legacyRunner('r1', [entry('c1', 'a'), entry('c1', 'b')])]);

        const summary = await run();

        expect(saved).toHaveLength(1);
        expect(saved[0].collectionId).toBe('c1');
        expect(saved[0].runner).toMatchObject({ id: 'r1', collectionId: 'c1', name: 'R1' });
        expect(saved[0].runner.requests.map(r => r.endpointId)).toEqual(['a', 'b']);
        expect(summary).toMatchObject({ moved: [{ id: 'r1', name: 'R1', collectionId: 'c1' }], dropped: [], skipped: [], pending: [], finished: true });
        expect(store[LEGACY_RUNNERS_KEY]).toBeNull();
        expect(store[MIGRATED_COLLECTIONS_KEY]).toEqual(['c1']);
    });

    test('drops entries from other collections and reports the runner name and count', async () => {
        const { run, saved } = setup([legacyRunner('mixed', [entry('c1', 'a'), entry('c2', 'x'), entry('c1', 'b'), entry('c2', 'y')])]);

        const summary = await run();

        expect(saved[0].runner.requests.map(r => r.endpointId)).toEqual(['a', 'b']);
        expect(summary.dropped).toEqual([{ name: 'MIXED', count: 2 }]);
    });

    test('makes the data file path relative when it is inside the collection folder', async () => {
        const { run, saved } = setup([
            legacyRunner('inside', [entry('c1', 'a')], { options: { dataFile: { path: '/work/one/data/users.csv', name: 'users.csv', rowCount: 3 } } }),
            legacyRunner('outside', [entry('c2', 'x')], { options: { dataFile: { path: '/elsewhere/users.csv', name: 'users.csv' } } })
        ]);

        await run();

        expect(saved.find(s => s.runner.id === 'inside').runner.options.dataFile).toEqual({ path: 'data/users.csv', name: 'users.csv' });
        expect(saved.find(s => s.runner.id === 'outside').runner.options.dataFile).toEqual({ path: '/elsewhere/users.csv', name: 'users.csv' });
    });

    test('copies lastRunAt into the local last-run store per collection', async () => {
        const { run, lastRuns } = setup([
            legacyRunner('r1', [entry('c1', 'a')], { lastRunAt: 1234 }),
            legacyRunner('r2', [entry('c1', 'b')])
        ]);

        await run();

        expect(lastRuns).toEqual([{ r1: 1234 }]);
    });

    test('migrates v1 overrides so the file only holds real edits', async () => {
        const { run, saved, resolveDefaults } = setup([
            legacyRunner('old', [entry('c1', 'a', { queryParams: [{ key: 'page', value: '1' }], headers: [{ key: 'X-A', value: 'edited' }] })], { overridesVersion: null })
        ]);

        await run();

        expect(resolveDefaults).toHaveBeenCalledWith('c1', 'a');
        expect(saved[0].runner.requests[0].overrides).toEqual({ headers: [{ key: 'X-A', value: 'edited' }] });
    });

    test('a second pass is idempotent: existing ids are skipped and nothing is saved twice', async () => {
        const { run, saved, store } = setup([legacyRunner('r1', [entry('c1', 'a')])], { existing: { c1: ['r1'] } });

        const summary = await run();

        expect(saved).toHaveLength(0);
        expect(summary.moved).toEqual([]);
        expect(store[MIGRATED_COLLECTIONS_KEY]).toEqual(['c1']);
        expect(store[LEGACY_RUNNERS_KEY]).toBeNull();
    });

    test('a runner whose collection is not loaded stays pending and the legacy key survives', async () => {
        const { run, saved, store } = setup([legacyRunner('r1', [entry('c1', 'a')]), legacyRunner('r9', [entry('gone', 'z')])]);

        const summary = await run();

        expect(saved.map(s => s.runner.id)).toEqual(['r1']);
        expect(summary.pending).toEqual(['gone']);
        expect(summary.finished).toBe(false);
        expect(store[LEGACY_RUNNERS_KEY]).toHaveLength(2);
        expect(store[MIGRATED_COLLECTIONS_KEY]).toEqual(['c1']);

        const again = await run();
        expect(saved).toHaveLength(1);
        expect(again.moved).toEqual([]);
        expect(again.pending).toEqual(['gone']);
    });

    test('writes the backup once before the first move and never again', async () => {
        const { run, store } = setup([legacyRunner('r1', [entry('c1', 'a')]), legacyRunner('r9', [entry('gone', 'z')])]);

        await run();
        const backup = store[LEGACY_BACKUP_KEY];
        expect(backup.runners).toHaveLength(2);
        await run();

        expect(store[LEGACY_BACKUP_KEY]).toBe(backup);
    });

    test('runners with no requests are skipped and reported, and an empty store is a no-op', async () => {
        const { run, saved } = setup([legacyRunner('empty', [])]);
        const result = await run();
        expect(saved).toHaveLength(0);
        expect(result.skipped).toEqual(['EMPTY']);
        expect(result.finished).toBe(true);

        const empty = setup(null);
        expect(await empty.run()).toMatchObject({ moved: [], finished: true });
        expect(empty.backendAPI.store.set).not.toHaveBeenCalled();
    });

    test('convertLegacyRunner and ownerCollectionId are pure helpers', () => {
        expect(ownerCollectionId(legacyRunner('r', [entry('c2', 'x')]))).toBe('c2');
        expect(ownerCollectionId(legacyRunner('r', []))).toBeNull();
        const { runner, droppedCount } = convertLegacyRunner(legacyRunner('r', [entry('c1', 'a'), entry('c3', 'q')]), { id: 'c1' });
        expect(droppedCount).toBe(1);
        expect(runner.requests).toEqual([{ collectionId: 'c1', endpointId: 'a', name: 'a', method: 'GET', path: '/a', postResponseScript: '', overrides: {} }]);
        expect(runner.options.dataFile).toBeNull();
    });
});
