import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

/**
 * Closing a collection opened in place must leave every file alone, and must
 * keep the stored credentials: they are the only part of such a collection
 * that does not live in its directory, so discarding them would make Close
 * destructive in the one dimension the files are not.
 */
describe('CollectionRepository.close', () => {
    let repository;
    let backendAPI;
    let secretStore;

    beforeEach(() => {
        backendAPI = {
            collections: {
                close: jest.fn().mockResolvedValue(undefined),
                delete: jest.fn().mockResolvedValue(undefined),
                get: jest.fn().mockResolvedValue({ id: 'c1', name: 'Petstore' }),
                saveVariables: jest.fn().mockResolvedValue(undefined),
                openExisting: jest.fn().mockResolvedValue({ opened: [], alreadyOpen: [], failed: [] })
            }
        };
        secretStore = { deleteScopePrefix: jest.fn().mockResolvedValue(undefined) };
        repository = new CollectionRepository(backendAPI, secretStore);
    });

    test('keeps the stored credentials', async () => {
        await repository.close('c1');

        expect(secretStore.deleteScopePrefix).not.toHaveBeenCalled();
    });

    test('does not delete and does not write variables', async () => {
        await repository.close('c1');

        expect(backendAPI.collections.close).toHaveBeenCalledWith('c1');
        expect(backendAPI.collections.delete).not.toHaveBeenCalled();
        expect(backendAPI.collections.saveVariables).not.toHaveBeenCalled();
    });

    test('evicts the cache so a closed collection is not re-served', async () => {
        await repository.getById('c1');
        expect(backendAPI.collections.get).toHaveBeenCalledTimes(1);

        await repository.close('c1');
        await repository.getById('c1');

        expect(backendAPI.collections.get).toHaveBeenCalledTimes(2);
    });

    test('reports a backend failure', async () => {
        backendAPI.collections.close.mockRejectedValue(new Error('store locked'));

        await expect(repository.close('c1')).rejects.toThrow('Failed to close collection');
    });

    test('delete still purges the credentials', async () => {
        await repository.delete('c1');

        expect(secretStore.deleteScopePrefix).toHaveBeenCalledWith('auth:c1:');
    });

    test('openExisting passes the picked path straight through', async () => {
        await repository.openExisting('/home/someone/repo');

        expect(backendAPI.collections.openExisting).toHaveBeenCalledWith('/home/someone/repo');
    });
});
