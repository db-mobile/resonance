import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { setCurrentEndpoint } from '../../src/modules/state/currentEndpoint.js';

function makeController(collection) {
    const controller = Object.create(CollectionController.prototype);
    controller.service = { getInheritedAuthInfo: jest.fn().mockResolvedValue({ authType: 'bearer' }) };
    controller.repository = { getById: jest.fn().mockResolvedValue(collection) };
    controller.handleFolderAuth = jest.fn();
    controller.handleCollectionAuth = jest.fn();
    return controller;
}

afterEach(() => setCurrentEndpoint(null));

describe('CollectionController inherited auth', () => {
    test('describeInheritedAuth answers for the current endpoint and null without one', async () => {
        const controller = makeController(null);

        await expect(controller.describeInheritedAuth()).resolves.toBeNull();

        setCurrentEndpoint({ collectionId: 'c1', endpointId: 'e1' });
        await expect(controller.describeInheritedAuth()).resolves.toEqual({ authType: 'bearer' });
        expect(controller.service.getInheritedAuthInfo).toHaveBeenCalledWith('c1', 'e1');
    });

    test('openAuthEditor routes to the folder or collection editor', async () => {
        const collection = { id: 'c1', folders: [{ id: 'f1', name: 'Admin' }] };
        const controller = makeController(collection);

        await controller.openAuthEditor('c1', 'f1');
        expect(controller.handleFolderAuth).toHaveBeenCalledWith(collection, collection.folders[0]);

        await controller.openAuthEditor('c1', null);
        await controller.openAuthEditor('c1', 'missing');
        expect(controller.handleCollectionAuth).toHaveBeenCalledTimes(2);
    });

    test('openAuthEditor ignores an unknown collection', async () => {
        const controller = makeController(null);

        await controller.openAuthEditor('c9');

        expect(controller.handleCollectionAuth).not.toHaveBeenCalled();
    });
});
