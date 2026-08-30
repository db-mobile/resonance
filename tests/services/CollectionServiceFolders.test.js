import { CollectionService } from '../../src/modules/services/CollectionService.js';

describe('CollectionService auto-folder id uniqueness', () => {
    let repository;
    let service;
    let collection;

    beforeEach(() => {
        collection = {
            id: 'c1',
            name: 'Test',
            endpoints: [],
            folders: [{ id: 'folder_v1_users', name: 'v1.users', endpoints: [] }]
        };
        repository = {
            getById: jest.fn().mockResolvedValue(collection),
            saveOne: jest.fn().mockResolvedValue(undefined),
            updateMetadata: jest.fn().mockResolvedValue(undefined),
            savePersistedUrl: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionService(repository, {}, { update: jest.fn() });
    });

    const addRequest = (path) => service.addRequestToCollection('c1', {
        name: 'req',
        protocol: 'http',
        method: 'GET',
        url: `https://api.example.com${path}`,
        path
    });

    test('a colliding sanitized name gets a numeric suffix', async () => {
        await addRequest('/v1-users/list');

        const created = collection.folders.find(f => f.name === 'v1-users');
        expect(created).toBeDefined();
        expect(created.id).toBe('folder_v1_users_2');
    });

    test('a folder with the same name is reused, not duplicated', async () => {
        await addRequest('/v1.users/list');

        expect(collection.folders).toHaveLength(1);
        expect(collection.folders[0].endpoints).toHaveLength(1);
    });

    test('a third collision advances the suffix', async () => {
        collection.folders.push({ id: 'folder_v1_users_2', name: 'v1 users', endpoints: [] });

        await addRequest('/v1&users/list');

        const created = collection.folders.find(f => f.name === 'v1&users');
        expect(created.id).toBe('folder_v1_users_3');
    });

    test('a non-colliding name keeps the bare base id', async () => {
        await addRequest('/orders/list');

        const created = collection.folders.find(f => f.name === 'orders');
        expect(created.id).toBe('folder_orders');
    });
});
