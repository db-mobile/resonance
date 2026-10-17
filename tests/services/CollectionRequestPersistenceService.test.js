import { CollectionRequestPersistenceService } from '../../src/modules/services/CollectionRequestPersistenceService.js';

function readerWithAuth(authConfig) {
    return {
        read: jest.fn(() => ({ url: null, method: null, pathParams: null, queryParams: null, headers: null, bodyState: null, authConfig })),
        hasBody: jest.fn(() => false)
    };
}

describe('CollectionRequestPersistenceService auth persistence', () => {
    let repository;

    const makeService = (formReader) => new CollectionRequestPersistenceService({
        repository,
        collectionService: {},
        statusDisplay: { update: jest.fn() },
        refreshCollections: jest.fn(),
        formReader
    });

    beforeEach(() => {
        repository = {
            updateEndpointFields: jest.fn().mockResolvedValue(undefined)
        };
    });

    test('saveHttpRequest saves auth in the same sidecar write as the other fields', async () => {
        const authConfig = { type: 'bearer', config: { token: 'sk-live-abc' } };

        await makeService(readerWithAuth(authConfig)).saveHttpRequest('c1', 'e1');

        expect(repository.updateEndpointFields).toHaveBeenCalledTimes(1);
        expect(repository.updateEndpointFields).toHaveBeenCalledWith('c1', 'e1', { authConfig });
    });

    test('saveHttpRequest persists an explicit inherit choice', async () => {
        await makeService(readerWithAuth({ type: 'inherit', config: {} })).saveHttpRequest('c1', 'e1');

        expect(repository.updateEndpointFields).toHaveBeenCalledWith('c1', 'e1', {
            authConfig: { type: 'inherit', config: {} }
        });
    });

    test('saveHttpRequest writes nothing when the form is empty', async () => {
        await makeService(readerWithAuth(null)).saveHttpRequest('c1', 'e1');

        expect(repository.updateEndpointFields).not.toHaveBeenCalled();
    });
});
