import { RunnerHistoryRepository, MAX_RUNS_PER_RUNNER } from '../../src/modules/storage/RunnerHistoryRepository.js';

describe('RunnerHistoryRepository', () => {
    let stored;
    let backendAPI;
    let repository;

    beforeEach(() => {
        stored = undefined;
        backendAPI = {
            store: {
                get: jest.fn(async () => stored),
                set: jest.fn(async (key, value) => { stored = value; })
            }
        };
        repository = new RunnerHistoryRepository(backendAPI);
    });

    test('keeps runs per runner, newest first', async () => {
        await repository.record('r1', { startedAt: 1 });
        await repository.record('r1', { startedAt: 2 });
        await repository.record('r2', { startedAt: 3 });

        expect((await repository.list('r1')).map(run => run.startedAt)).toEqual([2, 1]);
        expect((await repository.list('r2')).map(run => run.startedAt)).toEqual([3]);
        expect(backendAPI.store.set).toHaveBeenLastCalledWith('runnerRunHistory', expect.any(Object));
    });

    test(`caps each runner at ${MAX_RUNS_PER_RUNNER} runs`, async () => {
        for (let i = 0; i < MAX_RUNS_PER_RUNNER + 3; i++) {
            await repository.record('r1', { startedAt: i });
        }

        const runs = await repository.list('r1');
        expect(runs).toHaveLength(MAX_RUNS_PER_RUNNER);
        expect(runs[0].startedAt).toBe(MAX_RUNS_PER_RUNNER + 2);
    });

    test('concurrent records are not lost', async () => {
        await Promise.all([repository.record('r1', { startedAt: 1 }), repository.record('r2', { startedAt: 2 })]);

        expect(Object.keys(stored).sort()).toEqual(['r1', 'r2']);
    });

    test('remove drops one runner\'s history', async () => {
        await repository.record('r1', { startedAt: 1 });
        await repository.record('r2', { startedAt: 2 });

        await repository.remove('r1');

        expect(await repository.list('r1')).toEqual([]);
        expect(await repository.list('r2')).toHaveLength(1);
    });

    test('an unknown runner and a corrupt store both read as empty', async () => {
        stored = ['not', 'an', 'object'];

        expect(await repository.list('r1')).toEqual([]);
    });

    test('returned runs are copies', async () => {
        await repository.record('r1', { startedAt: 1, summary: { passed: 1 } });

        (await repository.list('r1'))[0].summary.passed = 99;

        expect((await repository.list('r1'))[0].summary.passed).toBe(1);
    });
});
