import { CollectionService } from '../../src/modules/services/CollectionService.js';

function makeService({ folder = null, folderAuth = null, collectionAuth = null, collection = { id: 'c1', name: 'Shop' } } = {}) {
    const repository = {
        getById: jest.fn().mockResolvedValue(collection),
        findFolderForEndpoint: jest.fn().mockResolvedValue(folder),
        getFolderAuthConfig: jest.fn().mockResolvedValue(folderAuth),
        getCollectionAuthConfig: jest.fn().mockResolvedValue(collectionAuth)
    };
    return { service: new CollectionService(repository, {}, { update: jest.fn() }), repository };
}

describe('CollectionService.getInheritedAuthInfo', () => {
    test('a folder with its own auth wins over the collection', async () => {
        const { service, repository } = makeService({
            folder: { id: 'f1', name: 'Admin', authConfig: { type: 'basic' } },
            folderAuth: { type: 'basic', config: {} }
        });

        await expect(service.getInheritedAuthInfo('c1', 'e1')).resolves.toEqual({
            collectionId: 'c1', collectionName: 'Shop', folderId: 'f1', folderName: 'Admin', authType: 'basic'
        });
        expect(repository.getFolderAuthConfig).toHaveBeenCalledWith('c1', 'f1');
        expect(repository.getCollectionAuthConfig).not.toHaveBeenCalled();
    });

    test('a folder that inherits falls through to the collection auth', async () => {
        const { service } = makeService({
            folder: { id: 'f1', name: 'Admin', authConfig: { type: 'inherit' } },
            collectionAuth: { type: 'bearer', config: {} }
        });

        await expect(service.getInheritedAuthInfo('c1', 'e1')).resolves.toEqual({
            collectionId: 'c1', collectionName: 'Shop', folderId: null, folderName: '', authType: 'bearer'
        });
    });

    test('a missing collection or auth yields empty names and type none', async () => {
        const { service } = makeService({ collection: null });

        await expect(service.getInheritedAuthInfo('c1', 'e1')).resolves.toEqual({
            collectionId: 'c1', collectionName: '', folderId: null, folderName: '', authType: 'none'
        });
    });
});
