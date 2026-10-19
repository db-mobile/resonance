import { RunnerRepository, LAST_RUNS_KEY } from '../../src/modules/storage/RunnerRepository.js';

function doc(id, name, extra = {}) {
    return { id, name, options: { stopOnError: true }, requests: [{ requestId: 'req_1', name: 'Health', method: 'GET', path: '/health' }], ...extra };
}

describe('RunnerRepository', () => {
    let repository;
    let backendAPI;
    let files;
    let store;

    beforeEach(() => {
        files = { c1: [doc('runner_a', 'Alpha', { seq: 10 })], c2: [doc('runner_b', 'Beta')] };
        let minted = 0;
        store = { [LAST_RUNS_KEY]: { runner_a: 1000 } };
        backendAPI = {
            collections: {
                list: jest.fn(async () => Object.keys(files)),
                runners: {
                    list: jest.fn(async (collectionId) => files[collectionId] ?? []),
                    save: jest.fn(async (collectionId, runnerDoc) => {
                        const stored = { ...runnerDoc, id: runnerDoc.id || `runner_new_${++minted}`, seq: runnerDoc.seq || 20 };
                        files[collectionId] = [...(files[collectionId] || []).filter(r => r.id !== stored.id), stored];
                        return stored;
                    }),
                    delete: jest.fn(async (collectionId, runnerId) => {
                        const before = files[collectionId]?.length ?? 0;
                        files[collectionId] = (files[collectionId] || []).filter(r => r.id !== runnerId);
                        return files[collectionId].length !== before;
                    })
                }
            },
            store: {
                get: jest.fn(async (key) => store[key] ?? null),
                set: jest.fn(async (key, value) => { store[key] = value; })
            }
        };
        repository = new RunnerRepository(backendAPI);
    });

    test('getAll lists every collection and maps requestId to endpointId with the owning collectionId', async () => {
        const runners = await repository.getAll();

        expect(runners.map(r => [r.id, r.collectionId])).toEqual([['runner_a', 'c1'], ['runner_b', 'c2']]);
        expect(runners[0].requests[0]).toEqual({
            collectionId: 'c1', endpointId: 'req_1', name: 'Health', method: 'GET', path: '/health', postResponseScript: '', overrides: {}
        });
        expect(runners[0].seq).toBe(10);
    });

    test('getAll merges lastRunAt from the local store', async () => {
        const runners = await repository.getAll();

        expect(runners.find(r => r.id === 'runner_a').lastRunAt).toBe(1000);
        expect(runners.find(r => r.id === 'runner_b').lastRunAt).toBeNull();
    });

    test('add sends an empty id and returns the runner the backend assigned', async () => {
        const added = await repository.add('c1', { name: 'Smoke', requests: [{ collectionId: 'c1', endpointId: 'req_1' }], options: { delayMs: 50 } });

        const sent = backendAPI.collections.runners.save.mock.calls[0][1];
        expect(sent.id).toBe('');
        expect(sent.requests[0]).toMatchObject({ requestId: 'req_1' });
        expect(sent.requests[0].collectionId).toBeUndefined();
        expect(added.id).toBe('runner_new_1');
        expect(added.collectionId).toBe('c1');
        expect(added.options).toMatchObject({ stopOnError: true, delayMs: 50, iterations: 1 });
        expect((await repository.getAllByCollection('c1')).map(r => r.id)).toEqual(['runner_a', 'runner_new_1']);
    });

    test('update merges onto the stored runner and replaces options whole', async () => {
        const updated = await repository.update('c1', 'runner_a', { name: 'Renamed', options: { stopOnError: false } });

        const sent = backendAPI.collections.runners.save.mock.calls[0][1];
        expect(sent).toMatchObject({ id: 'runner_a', name: 'Renamed', seq: 10 });
        expect(sent.options).toEqual({ stopOnError: false, delayMs: 0, iterations: 1, dataFile: null });
        expect(updated.name).toBe('Renamed');
        expect(updated.lastRunAt).toBe(1000);
    });

    test('update of an unknown runner returns null without saving', async () => {
        expect(await repository.update('c1', 'nope', { name: 'x' })).toBeNull();
        expect(backendAPI.collections.runners.save).not.toHaveBeenCalled();
    });

    test('delete removes the file and the last-run entry', async () => {
        expect(await repository.delete('c1', 'runner_a')).toBe(true);

        expect(backendAPI.collections.runners.delete).toHaveBeenCalledWith('c1', 'runner_a');
        expect(store[LAST_RUNS_KEY]).toEqual({});
        expect(await repository.getAllByCollection('c1')).toEqual([]);
        expect(await repository.delete('c1', 'runner_a')).toBe(false);
    });

    test('updateLastRun writes only the local store, never a file', async () => {
        await repository.getAll();
        await repository.updateLastRun('runner_b');

        expect(backendAPI.collections.runners.save).not.toHaveBeenCalled();
        expect(typeof store[LAST_RUNS_KEY].runner_b).toBe('number');
        expect((await repository.getById('c2', 'runner_b')).lastRunAt).toBe(store[LAST_RUNS_KEY].runner_b);
    });

    test('mergeLastRuns never overwrites a newer timestamp', async () => {
        await repository.mergeLastRuns({ runner_a: 500, runner_b: 700 });

        expect(store[LAST_RUNS_KEY]).toEqual({ runner_a: 1000, runner_b: 700 });
    });

    test('a saved error carries a message even when the backend rejects with a string', async () => {
        backendAPI.collections.runners.save.mockRejectedValueOnce('legacy format');

        await expect(repository.add('c1', { name: 'x' })).rejects.toThrow('Failed to save runner: legacy format');
    });

    test('invalidate forces the next read to list again', async () => {
        await repository.getAllByCollection('c1');
        await repository.getAllByCollection('c1');
        expect(backendAPI.collections.runners.list).toHaveBeenCalledTimes(1);

        repository.invalidate('c1');
        await repository.getAllByCollection('c1');
        expect(backendAPI.collections.runners.list).toHaveBeenCalledTimes(2);

        await repository.getAll({ fresh: true });
        expect(backendAPI.collections.runners.list).toHaveBeenCalledTimes(4);
    });

    test('a failing list yields no runners for that collection and is not cached', async () => {
        backendAPI.collections.runners.list.mockRejectedValueOnce(new Error('closed'));

        expect(await repository.getAllByCollection('c1')).toEqual([]);
        expect((await repository.getAllByCollection('c1')).map(r => r.id)).toEqual(['runner_a']);
    });

    test('findById scans every open collection', async () => {
        expect((await repository.findById('runner_b')).collectionId).toBe('c2');
        expect(await repository.findById('missing')).toBeUndefined();
    });

    test('reads are copies, so unsaved UI edits never leak into the cache', async () => {
        const loaded = await repository.getById('c1', 'runner_a');
        loaded.requests[0].postResponseScript = 'unsaved edit';

        expect((await repository.getById('c1', 'runner_a')).requests[0].postResponseScript).toBe('');
    });

    test('concurrent saves are serialised and both land', async () => {
        await Promise.all([
            repository.add('c1', { name: 'A' }),
            repository.add('c1', { name: 'B' })
        ]);

        expect(backendAPI.collections.runners.save).toHaveBeenCalledTimes(2);
        expect((await repository.getAllByCollection('c1')).map(r => r.name)).toEqual(['Alpha', 'A', 'B']);
    });

    test('RunnerRepository.shared hands every runner tab the same instance', () => {
        expect(RunnerRepository.shared(backendAPI)).toBe(RunnerRepository.shared(backendAPI));
    });
});
