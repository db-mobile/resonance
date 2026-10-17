import { EnvironmentRepository } from '../../src/modules/storage/EnvironmentRepository.js';

describe('EnvironmentRepository.invalidateCache', () => {
    test('forces the next read to hit the store again', async () => {
        const data = { items: [{ id: 'env1', name: 'Dev', variables: {} }], activeEnvironmentId: 'env1' };
        const backendAPI = {
            store: { get: jest.fn().mockResolvedValue(data), set: jest.fn().mockResolvedValue(undefined) }
        };
        const repository = new EnvironmentRepository(backendAPI, null);

        await repository.getAllEnvironments();
        await repository.getAllEnvironments();
        expect(backendAPI.store.get).toHaveBeenCalledTimes(1);

        repository.invalidateCache();
        await repository.getAllEnvironments();

        expect(backendAPI.store.get).toHaveBeenCalledTimes(2);
    });
});
