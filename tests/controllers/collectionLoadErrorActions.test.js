import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

describe('load-error row actions', () => {
    const makeFake = () => ({
        backendAPI: { collections: { pickDirectory: jest.fn().mockResolvedValue('/new/place') } },
        service: {
            closeCollection: jest.fn().mockResolvedValue(true),
            relocateCollection: jest.fn().mockResolvedValue({ id: 'c9', name: 'Payments' })
        },
        closeTabsForCollection: jest.fn().mockResolvedValue(undefined),
        loadCollectionsWithExpansionState: jest.fn().mockResolvedValue([])
    });
    const error = { id: 'c9', path: '/old/place', kind: 'missing', removable: true };

    test('Remove closes the index entry, its tabs, and reloads', async () => {
        const fake = makeFake();
        await CollectionController.prototype.handleRemoveMissingCollection.call(fake, error);

        expect(fake.service.closeCollection).toHaveBeenCalledWith('c9');
        expect(fake.closeTabsForCollection).toHaveBeenCalledWith('c9');
        expect(fake.loadCollectionsWithExpansionState).toHaveBeenCalled();
    });

    test('Locate relocates to the picked folder without remembering it as the default', async () => {
        const fake = makeFake();
        await CollectionController.prototype.handleLocateMissingCollection.call(fake, error);

        expect(fake.backendAPI.collections.pickDirectory).toHaveBeenCalledWith(false);
        expect(fake.service.relocateCollection).toHaveBeenCalledWith('c9', '/new/place');
        expect(fake.loadCollectionsWithExpansionState).toHaveBeenCalled();
    });

    test('cancelling the picker changes nothing', async () => {
        const fake = makeFake();
        fake.backendAPI.collections.pickDirectory.mockResolvedValue(null);
        await CollectionController.prototype.handleLocateMissingCollection.call(fake, error);

        expect(fake.service.relocateCollection).not.toHaveBeenCalled();
        expect(fake.loadCollectionsWithExpansionState).not.toHaveBeenCalled();
    });
});
