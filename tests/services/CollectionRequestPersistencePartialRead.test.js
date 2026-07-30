import { CollectionRequestPersistenceService } from '../../src/modules/services/CollectionRequestPersistenceService.js';
import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

/**
 * Editing one request must never delete a different collection.
 *
 * `collections_get_all` skips collections it cannot load, so a momentarily
 * unreadable file (mid-checkout, conflict marker, partial write) makes the
 * renderer's view of storage incomplete. A single-endpoint edit must write only
 * the collection it touched, never reconcile the full set against that
 * incomplete view.
 */
describe('CollectionRequestPersistenceService with an unreadable collection on disk', () => {
    let backendAPI;
    let repository;
    let service;
    let readable;

    beforeEach(() => {
        readable = {
            id: 'c1',
            name: 'Readable',
            endpoints: [
                {
                    id: 'e1',
                    protocol: 'sse',
                    method: 'SSE',
                    httpMethod: 'GET',
                    path: 'https://api.example.com/v1/users'
                }
            ],
            folders: []
        };

        backendAPI = {
            collections: {
                getAll: jest.fn().mockResolvedValue([readable]),
                get: jest.fn().mockImplementation(async (id) => {
                    if (id === 'c1') {
                        return readable;
                    }
                    throw new Error('Failed to read collection file');
                }),
                list: jest.fn().mockResolvedValue(['c1', 'c2']),
                save: jest.fn().mockResolvedValue(undefined),
                delete: jest.fn().mockResolvedValue(undefined),
                getEndpointData: jest.fn().mockResolvedValue({}),
                saveEndpointData: jest.fn().mockResolvedValue(undefined)
            }
        };

        repository = new CollectionRepository(backendAPI);
        service = new CollectionRequestPersistenceService({
            repository,
            collectionService: {},
            statusDisplay: { update: jest.fn() },
            refreshCollections: jest.fn()
        });
    });

    test('patchEndpointRecords leaves the unreadable collection on disk', async () => {
        await service.patchEndpointRecords('c1', 'e1', { httpMethod: 'POST' });

        expect(backendAPI.collections.delete).not.toHaveBeenCalled();
        expect(backendAPI.collections.list).not.toHaveBeenCalled();
        expect(backendAPI.collections.save).toHaveBeenCalledTimes(1);
        expect(backendAPI.collections.save).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'c1' })
        );

        const saved = backendAPI.collections.save.mock.calls.at(-1)[0];
        expect(saved.endpoints[0].httpMethod).toBe('POST');
    });

    test('updateEndpointPathFromUrl leaves the unreadable collection on disk', async () => {
        await service.updateEndpointPathFromUrl('c1', 'e1', 'https://api.example.com/v2/orders');

        expect(backendAPI.collections.delete).not.toHaveBeenCalled();
        expect(backendAPI.collections.list).not.toHaveBeenCalled();
        expect(backendAPI.collections.save).toHaveBeenCalledTimes(1);
        expect(backendAPI.collections.save).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'c1' })
        );
    });
});
