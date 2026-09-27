import { CollectionService } from '../../src/modules/services/CollectionService.js';
import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

describe('structural saves use fresh data, not a stale cache', () => {
    let repository;
    let service;
    const onDisk = () => ({ id: 'c1', name: 'C', endpoints: [{ id: 'kept', name: 'Kept' }], folders: [] });
    const stale = { id: 'c1', name: 'C', endpoints: [{ id: 'kept', name: 'Kept' }, { id: 'deleted', name: 'Gone' }], folders: [] };

    beforeEach(() => {
        repository = {
            getById: jest.fn().mockResolvedValue(stale),
            readForUpdate: jest.fn(async () => onDisk()),
            saveOne: jest.fn().mockResolvedValue(undefined),
            savePersistedUrl: jest.fn().mockResolvedValue(undefined),
            deletePersistedEndpointData: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionService(repository, {}, { update: jest.fn() });
    });

    test('adding a request reads from disk and declares the one new id', async () => {
        const created = await service.addRequestToCollection('c1', {
            name: 'New',
            protocol: 'http',
            method: 'GET',
            url: 'https://api.example.com/x',
            path: '/x'
        });

        expect(repository.getById).not.toHaveBeenCalled();
        const [saved, options] = repository.saveOne.mock.calls[0];
        expect(saved.endpoints.map(e => e.id)).toEqual(['kept', created.id]);
        expect(options).toEqual({ newRequestIds: [created.id] });
    });

    test('renaming reads from disk, so a request deleted elsewhere is not carried back', async () => {
        await service.renameRequest('c1', 'kept', 'Renamed');

        const [saved] = repository.saveOne.mock.calls[0];
        expect(saved.endpoints.map(e => e.id)).toEqual(['kept']);
    });
});

describe('CollectionRepository cache', () => {
    test('a full listing drops cached collections so the next read is fresh', async () => {
        const backendAPI = {
            collections: {
                getAll: jest.fn().mockResolvedValue([]),
                get: jest.fn()
                    .mockResolvedValueOnce({ id: 'c1', name: 'Old', endpoints: [], folders: [] })
                    .mockResolvedValueOnce({ id: 'c1', name: 'New', endpoints: [], folders: [] })
            }
        };
        const repository = new CollectionRepository(backendAPI);

        expect((await repository.getById('c1')).name).toBe('Old');
        await repository.getAll();
        expect((await repository.getById('c1')).name).toBe('New');
    });

    test('new request ids are forwarded to the backend only when given', async () => {
        const backendAPI = { collections: { save: jest.fn().mockResolvedValue([]) } };
        const repository = new CollectionRepository(backendAPI);

        await repository.saveOne({ id: 'c1', endpoints: [], folders: [] }, { newRequestIds: ['n1'] });
        await repository.saveOne({ id: 'c1', endpoints: [], folders: [] });

        expect(backendAPI.collections.save.mock.calls[0][1]).toEqual(['n1']);
        expect(backendAPI.collections.save.mock.calls[1]).toHaveLength(1);
    });
});
