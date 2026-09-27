import { CollectionRequestPersistenceService } from '../../src/modules/services/CollectionRequestPersistenceService.js';

describe('CollectionRequestPersistenceService auth persistence', () => {
    let repository;
    let service;

    beforeEach(() => {
        repository = {
            updateEndpointFields: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionRequestPersistenceService({
            repository,
            collectionService: {},
            statusDisplay: { update: jest.fn() },
            refreshCollections: jest.fn()
        });
    });

    test('saveHttpRequest saves auth in the same sidecar write as the other fields', async () => {
        const authConfig = { type: 'bearer', config: { token: 'sk-live-abc' } };
        const authManager = { getAuthConfig: jest.fn(() => authConfig) };
        const parseKeyValuePairs = jest.fn(() => ({}));

        await service.saveHttpRequest('c1', 'e1', parseKeyValuePairs, authManager);

        expect(repository.updateEndpointFields).toHaveBeenCalledTimes(1);
        expect(repository.updateEndpointFields).toHaveBeenCalledWith('c1', 'e1', { authConfig });
    });

    test('saveHttpRequest persists an explicit inherit choice', async () => {
        const authManager = { getAuthConfig: jest.fn(() => ({ type: 'inherit', config: {} })) };

        await service.saveHttpRequest('c1', 'e1', jest.fn(() => ({})), authManager);

        expect(repository.updateEndpointFields).toHaveBeenCalledWith('c1', 'e1', {
            authConfig: { type: 'inherit', config: {} }
        });
    });
});
