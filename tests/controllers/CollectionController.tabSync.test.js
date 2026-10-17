import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { app } from '../../src/modules/appContext.js';

function makeController() {
    const controller = Object.create(CollectionController.prototype);
    controller.renameDialog = { show: jest.fn() };
    controller.service = { renameRequest: jest.fn().mockResolvedValue(undefined) };
    controller.loadCollectionsWithExpansionState = jest.fn().mockResolvedValue(undefined);
    return controller;
}

const collection = { id: 'c1', name: 'Petstore' };
const endpoint = { id: 'e1', name: 'List pets', path: '/pets' };

afterEach(() => {
    delete app.workspaceTabController;
});

describe('CollectionController.closeTabsForCollection', () => {
    test('delegates to the workspace tab controller', async () => {
        app.workspaceTabController = { closeTabsForCollection: jest.fn().mockResolvedValue(undefined) };

        await makeController().closeTabsForCollection('c1');

        expect(app.workspaceTabController.closeTabsForCollection).toHaveBeenCalledWith('c1');
    });

    test('is a no-op without the tab controller', async () => {
        await expect(makeController().closeTabsForCollection('c1')).resolves.toBeUndefined();
    });
});

describe('CollectionController.handleRenameRequest', () => {
    test('renames the request, reloads, and asks the tab controller to rename matching tabs', async () => {
        const controller = makeController();
        controller.renameDialog.show.mockResolvedValue('Fetch pets');
        app.workspaceTabController = { renameTabsForEndpoint: jest.fn().mockResolvedValue(undefined) };

        await controller.handleRenameRequest(collection, endpoint);

        expect(controller.renameDialog.show).toHaveBeenCalledWith('List pets', expect.objectContaining({ confirmText: 'Rename' }));
        expect(controller.service.renameRequest).toHaveBeenCalledWith('c1', 'e1', 'Fetch pets');
        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);
        expect(app.workspaceTabController.renameTabsForEndpoint).toHaveBeenCalledWith('c1', 'e1', 'Fetch pets');
    });

    test('an unchanged or empty name changes nothing', async () => {
        const controller = makeController();
        controller.renameDialog.show.mockResolvedValueOnce('List pets').mockResolvedValueOnce('');

        await controller.handleRenameRequest(collection, endpoint);
        await controller.handleRenameRequest(collection, endpoint);

        expect(controller.service.renameRequest).not.toHaveBeenCalled();
        expect(controller.loadCollectionsWithExpansionState).not.toHaveBeenCalled();
    });

    test('falls back to the path as the current name and works without a tab controller', async () => {
        const controller = makeController();
        controller.renameDialog.show.mockResolvedValue('Named');

        await controller.handleRenameRequest(collection, { id: 'e1', path: '/pets' });

        expect(controller.renameDialog.show.mock.calls[0][0]).toBe('/pets');
        expect(controller.service.renameRequest).toHaveBeenCalledWith('c1', 'e1', 'Named');
    });
});
