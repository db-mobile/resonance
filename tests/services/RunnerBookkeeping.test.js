import { RunnerBookkeeping } from '../../src/modules/services/RunnerBookkeeping.js';

function setup() {
    const repository = {
        getAllByCollection: jest.fn(async () => [{ id: 'r1' }, { id: 'r2' }]),
        removeLastRuns: jest.fn(async () => {}),
        invalidate: jest.fn()
    };
    const historyRepository = { removeMany: jest.fn(async () => {}) };
    const bookkeeping = new RunnerBookkeeping({ repository, historyRepository });
    return { bookkeeping, repository, historyRepository };
}

test('forgetCollection clears last runs and history for that collection and drops its cache', async () => {
    const { bookkeeping, repository, historyRepository } = setup();

    await bookkeeping.forgetCollection('c1');

    expect(repository.getAllByCollection).toHaveBeenCalledWith('c1');
    expect(repository.removeLastRuns).toHaveBeenCalledWith(['r1', 'r2']);
    expect(historyRepository.removeMany).toHaveBeenCalledWith(['r1', 'r2']);
    expect(repository.invalidate).toHaveBeenCalledWith('c1');
});

test('a collection without runners only drops the cache', async () => {
    const { bookkeeping, repository, historyRepository } = setup();
    repository.getAllByCollection.mockResolvedValue([]);

    await bookkeeping.forgetCollection('c2');

    expect(repository.removeLastRuns).not.toHaveBeenCalled();
    expect(historyRepository.removeMany).not.toHaveBeenCalled();
    expect(repository.invalidate).toHaveBeenCalledWith('c2');
});
