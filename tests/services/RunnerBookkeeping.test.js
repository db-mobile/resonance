import { RunnerBookkeeping } from '../../src/modules/services/RunnerBookkeeping.js';
import { LEGACY_RUNNERS_KEY } from '../../src/modules/storage/runnerMigration.js';
import { toast } from '../../src/modules/ui/Toast.js';

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { success: jest.fn(), warning: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

function setup(legacy = null) {
    const store = { [LEGACY_RUNNERS_KEY]: legacy };
    const backendAPI = {
        store: {
            get: jest.fn(async (key) => store[key] ?? null),
            set: jest.fn(async (key, value) => { store[key] = value; })
        }
    };
    const repository = {
        getAllByCollection: jest.fn(async () => [{ id: 'r1' }, { id: 'r2' }]),
        put: jest.fn(async (_cid, runner) => runner),
        mergeLastRuns: jest.fn(async () => {}),
        removeLastRuns: jest.fn(async () => {}),
        invalidate: jest.fn()
    };
    const historyRepository = { removeMany: jest.fn(async () => {}) };
    const bookkeeping = new RunnerBookkeeping({ backendAPI, repository, historyRepository });
    return { bookkeeping, repository, historyRepository, backendAPI, store };
}

beforeEach(() => jest.clearAllMocks());

test('forgetCollection clears last runs and history for that collection and drops its cache', async () => {
    const { bookkeeping, repository, historyRepository } = setup();

    await bookkeeping.forgetCollection('c1');

    expect(repository.getAllByCollection).toHaveBeenCalledWith('c1');
    expect(repository.removeLastRuns).toHaveBeenCalledWith(['r1', 'r2']);
    expect(historyRepository.removeMany).toHaveBeenCalledWith(['r1', 'r2']);
    expect(repository.invalidate).toHaveBeenCalledWith('c1');
});

test('a migration pass announces moved runners and dropped entries, and runs once at a time', async () => {
    const legacy = [
        { id: 'r9', name: 'Mixed', overridesVersion: 2, requests: [{ collectionId: 'c1', endpointId: 'a' }, { collectionId: 'c2', endpointId: 'b' }], options: {} }
    ];
    const { bookkeeping, repository } = setup(legacy);
    repository.getAllByCollection.mockResolvedValue([]);
    const collections = [{ id: 'c1', name: 'One' }];
    const collectionRepository = {};

    const [first, second] = await Promise.all([
        bookkeeping.runMigrationPass(collections, collectionRepository),
        bookkeeping.runMigrationPass(collections, collectionRepository)
    ]);

    expect(first).toBe(second);
    expect(repository.put).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Moved 1 saved runner into its collection folder');
    expect(toast.warning).toHaveBeenCalledWith('1 runner lost requests from other collections: Mixed');
});

test('a quiet pass shows no toast', async () => {
    const { bookkeeping } = setup(null);

    await bookkeeping.runMigrationPass([], {});

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
});
