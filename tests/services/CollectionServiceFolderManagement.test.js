import { CollectionService } from '../../src/modules/services/CollectionService.js';
import { findFolder, folderChainForRequest, findRequest } from '../../src/modules/collections/collectionTree.js';

const onDisk = () => ({
    id: 'c1',
    name: 'C',
    endpoints: [
        { id: 'r1', name: 'Root', method: 'GET', path: '/r' },
        { id: 'a1', name: 'In A', method: 'POST', path: '/a', headers: { X: '1' } }
    ],
    folders: [{ id: 'fA', name: 'A', endpoints: [{ id: 'a1', name: 'In A', method: 'POST', path: '/a', headers: { X: '1' } }] }]
});

describe('CollectionService folder and request management', () => {
    let repository;
    let service;

    beforeEach(() => {
        repository = {
            readForUpdate: jest.fn(async () => onDisk()),
            saveOne: jest.fn().mockResolvedValue(undefined),
            deleteFolder: jest.fn().mockResolvedValue(['a1']),
            copyEndpointData: jest.fn().mockResolvedValue(undefined),
            savePersistedUrl: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionService(repository, {}, { update: jest.fn() });
    });

    const saved = () => repository.saveOne.mock.calls.at(-1)[0];

    test('createFolder adds a uniquely named folder under the given parent', async () => {
        const folder = await service.createFolder('c1', 'fA', 'Nested');

        expect(findFolder(saved(), folder.id)).toMatchObject({ name: 'Nested' });
        expect(findFolder(saved(), 'fA').folders.map(f => f.id)).toEqual([folder.id]);
    });

    test('renameFolder renames and rejects unknown folders', async () => {
        await service.renameFolder('c1', 'fA', 'Renamed');
        expect(findFolder(saved(), 'fA').name).toBe('Renamed');

        await expect(service.renameFolder('c1', 'nope', 'X')).rejects.toThrow('not found');
    });

    test('duplicateRequest places the copy beside the original and copies its data', async () => {
        const copy = await service.duplicateRequest('c1', 'a1', 'In A (copy)');

        expect(copy.id).not.toBe('a1');
        expect(folderChainForRequest(saved(), copy.id).map(f => f.id)).toEqual(['fA']);
        expect(findRequest(saved(), copy.id)).toMatchObject({ name: 'In A (copy)', method: 'POST', headers: { X: '1' } });
        expect(repository.saveOne.mock.calls.at(-1)[1]).toEqual({ newRequestIds: [copy.id] });
        expect(repository.copyEndpointData).toHaveBeenCalledWith('c1', 'a1', copy.id);
    });

    test('moveRequestToFolder moves into a folder and back to the root', async () => {
        await service.moveRequestToFolder('c1', 'r1', 'fA');
        expect(folderChainForRequest(saved(), 'r1').map(f => f.id)).toEqual(['fA']);

        await service.moveRequestToFolder('c1', 'a1', null);
        expect(folderChainForRequest(saved(), 'a1')).toEqual([]);
    });

    test('addRequestToCollection honours an explicit folder', async () => {
        const created = await service.addRequestToCollection('c1', {
            name: 'New', protocol: 'http', method: 'GET', url: 'https://x.test/new', path: '/new', folderId: 'fA'
        });

        expect(folderChainForRequest(saved(), created.id).map(f => f.id)).toEqual(['fA']);
    });

    test('deleteFolder delegates to the repository and returns the removed ids', async () => {
        await expect(service.deleteFolder('c1', 'fA')).resolves.toEqual(['a1']);
    });
});
