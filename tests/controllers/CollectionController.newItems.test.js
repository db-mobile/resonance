jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }
}));
jest.mock('../../src/modules/collections/collectionTree.js', () => ({
    ...jest.requireActual('../../src/modules/collections/collectionTree.js'),
    folderChainForRequest: jest.fn(() => [{ id: 'f1', name: 'Admin' }]),
    folderOutline: jest.fn(() => [{ id: 'f1', name: 'Admin', depth: 0 }]),
    requestsInFolder: jest.fn(() => [{ id: 'e1', protocol: 'http' }, { id: 'e2', protocol: 'mqtt' }])
}));

import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { app } from '../../src/modules/appContext.js';

function makeController() {
    const controller = Object.create(CollectionController.prototype);
    controller.collectionDialogs = {
        showNewRequestDialog: jest.fn(),
        showNewCollectionDialog: jest.fn(),
        showSaveToCollectionDialog: jest.fn()
    };
    controller.service = {
        addRequestToCollection: jest.fn().mockResolvedValue(undefined),
        createCollection: jest.fn().mockResolvedValue({ id: 'c9' }),
        deleteRequestFromCollection: jest.fn().mockResolvedValue(undefined),
        duplicateRequest: jest.fn().mockResolvedValue(undefined),
        moveRequestToFolder: jest.fn().mockResolvedValue(undefined),
        createFolder: jest.fn().mockResolvedValue(undefined),
        renameFolder: jest.fn().mockResolvedValue(undefined),
        deleteFolder: jest.fn().mockResolvedValue(['e1', 'e2'])
    };
    controller.confirmDialog = { show: jest.fn().mockResolvedValue(true) };
    controller.renameDialog = { show: jest.fn() };
    controller.moveRequestDialog = { show: jest.fn() };
    controller.loadCollections = jest.fn().mockResolvedValue(undefined);
    controller.loadCollectionsWithExpansionState = jest.fn().mockResolvedValue(undefined);
    controller._resetIfCurrentEndpoint = jest.fn().mockResolvedValue(undefined);
    return controller;
}

const collection = { id: 'c1', name: 'Petstore' };
const endpoint = { id: 'e1', name: 'List pets', path: '/pets' };
const folder = { id: 'f1', name: 'Admin' };

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
    delete app.workspaceTabController;
});

describe('creating requests and collections', () => {
    test('handleNewRequest adds the request into the chosen folder and reloads', async () => {
        const controller = makeController();
        controller.collectionDialogs.showNewRequestDialog.mockResolvedValue({ name: 'R', method: 'GET', path: '/r' });

        await controller.handleNewRequest(collection, 'f1');

        expect(controller.service.addRequestToCollection).toHaveBeenCalledWith('c1', { name: 'R', method: 'GET', path: '/r', folderId: 'f1' });
        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);
    });

    test('handleNewRequest at the root passes the data through untouched', async () => {
        const controller = makeController();
        const data = { name: 'R', method: 'GET', path: '/r' };
        controller.collectionDialogs.showNewRequestDialog.mockResolvedValue(data);

        await controller.handleNewRequest(collection);

        expect(controller.service.addRequestToCollection).toHaveBeenCalledWith('c1', data);
    });

    test('handleNewCollection creates and reloads, and a cancel creates nothing', async () => {
        const controller = makeController();
        controller.collectionDialogs.showNewCollectionDialog.mockResolvedValueOnce({ name: 'New' }).mockResolvedValueOnce(null);

        await controller.handleNewCollection();
        await controller.handleNewCollection();

        expect(controller.service.createCollection).toHaveBeenCalledTimes(1);
        expect(controller.service.createCollection).toHaveBeenCalledWith({ name: 'New' });
        expect(controller.loadCollections).toHaveBeenCalledTimes(1);
    });

    test('handleNewRequestInEmptySpace asks for the request first and creates nothing if either dialog is cancelled', async () => {
        const controller = makeController();
        controller.collectionDialogs.showNewRequestDialog.mockResolvedValueOnce(null).mockResolvedValueOnce({ name: 'R' });
        controller.collectionDialogs.showNewCollectionDialog.mockResolvedValueOnce(null);

        await controller.handleNewRequestInEmptySpace();
        expect(controller.collectionDialogs.showNewCollectionDialog).not.toHaveBeenCalled();

        await controller.handleNewRequestInEmptySpace();
        expect(controller.service.createCollection).not.toHaveBeenCalled();
        expect(controller.service.addRequestToCollection).not.toHaveBeenCalled();
    });

    test('handleNewRequestInEmptySpace creates the collection then adds the request to it', async () => {
        const controller = makeController();
        controller.collectionDialogs.showNewRequestDialog.mockResolvedValue({ name: 'R' });
        controller.collectionDialogs.showNewCollectionDialog.mockResolvedValue({ name: 'New' });

        await controller.handleNewRequestInEmptySpace();

        expect(controller.service.addRequestToCollection).toHaveBeenCalledWith('c9', { name: 'R' });
        expect(controller.loadCollections).toHaveBeenCalledTimes(1);
    });

    test('showSaveToCollectionDialog reloads with expansion state only on a result', async () => {
        const controller = makeController();
        const saved = { collectionId: 'c1', endpointId: 'e7', name: 'R' };
        controller.collectionDialogs.showSaveToCollectionDialog.mockResolvedValueOnce(saved).mockResolvedValueOnce(null);

        await expect(controller.showSaveToCollectionDialog({ name: 'R' })).resolves.toBe(saved);
        await expect(controller.showSaveToCollectionDialog({ name: 'R' })).resolves.toBeNull();

        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);
    });
});

describe('deleting, duplicating and moving requests', () => {
    test('handleDeleteRequest confirms, deletes, resets the form and reloads', async () => {
        const controller = makeController();

        await controller.handleDeleteRequest(collection, endpoint);

        expect(controller.confirmDialog.show.mock.calls[0][1]).toMatchObject({ dangerous: true, confirmText: 'Delete' });
        expect(controller.service.deleteRequestFromCollection).toHaveBeenCalledWith('c1', 'e1');
        expect(controller._resetIfCurrentEndpoint).toHaveBeenCalledWith('c1', ['e1']);
        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);
    });

    test('a declined confirmation deletes nothing', async () => {
        const controller = makeController();
        controller.confirmDialog.show.mockResolvedValue(false);

        await controller.handleDeleteRequest(collection, endpoint);

        expect(controller.service.deleteRequestFromCollection).not.toHaveBeenCalled();
    });

    test('handleDuplicateRequest copies under a "(copy)" name and reports failures', async () => {
        const controller = makeController();

        await controller.handleDuplicateRequest(collection, endpoint);
        expect(controller.service.duplicateRequest).toHaveBeenCalledWith('c1', 'e1', 'List pets (copy)');
        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);

        controller.service.duplicateRequest.mockRejectedValue(new Error('disk full'));
        await controller.handleDuplicateRequest(collection, { id: 'e2', path: '/p' });
        expect(toast.error.mock.calls[0][0]).toContain('disk full');
    });

    test('handleMoveRequest moves to the chosen folder and ignores cancel or same-folder picks', async () => {
        const controller = makeController();
        controller.moveRequestDialog.show.mockResolvedValueOnce('f2').mockResolvedValueOnce(undefined).mockResolvedValueOnce('f1');

        await controller.handleMoveRequest(collection, endpoint);
        expect(controller.moveRequestDialog.show).toHaveBeenCalledWith(expect.objectContaining({ currentFolderId: 'f1', folders: expect.any(Array) }));
        expect(controller.service.moveRequestToFolder).toHaveBeenCalledWith('c1', 'e1', 'f2');

        await controller.handleMoveRequest(collection, endpoint);
        await controller.handleMoveRequest(collection, endpoint);
        expect(controller.service.moveRequestToFolder).toHaveBeenCalledTimes(1);
    });
});

describe('folders', () => {
    test('handleNewFolder creates under the given parent and reports failures', async () => {
        const controller = makeController();
        controller.renameDialog.show.mockResolvedValueOnce('Sub').mockResolvedValueOnce('').mockResolvedValueOnce('Bad');

        await controller.handleNewFolder(collection, 'f1');
        expect(controller.service.createFolder).toHaveBeenCalledWith('c1', 'f1', 'Sub');

        await controller.handleNewFolder(collection, null);
        expect(controller.service.createFolder).toHaveBeenCalledTimes(1);

        controller.service.createFolder.mockRejectedValue(new Error('exists'));
        await controller.handleNewFolder(collection, null);
        expect(toast.error.mock.calls[0][0]).toContain('exists');
    });

    test('handleRenameFolder renames only when the name changed', async () => {
        const controller = makeController();
        controller.renameDialog.show.mockResolvedValueOnce('Admin').mockResolvedValueOnce('Ops');

        await controller.handleRenameFolder(collection, folder);
        await controller.handleRenameFolder(collection, folder);

        expect(controller.service.renameFolder).toHaveBeenCalledTimes(1);
        expect(controller.service.renameFolder).toHaveBeenCalledWith('c1', 'f1', 'Ops');
    });

    test('handleDeleteFolder confirms with the request count, then resets any removed current request', async () => {
        const controller = makeController();

        await controller.handleDeleteFolder(collection, folder);

        expect(controller.confirmDialog.show.mock.calls[0][0]).toContain('2 request');
        expect(controller.service.deleteFolder).toHaveBeenCalledWith('c1', 'f1');
        expect(controller._resetIfCurrentEndpoint).toHaveBeenCalledWith('c1', ['e1', 'e2']);
        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);
    });
});

describe('handleRunRequests', () => {
    test('opens a runner tab with only the runnable requests', async () => {
        const controller = makeController();
        app.workspaceTabController = { createRunnerTab: jest.fn().mockResolvedValue(undefined) };
        const http = { id: 'e1', protocol: 'http' };

        await controller.handleRunRequests(collection, [http, { id: 'e2', protocol: 'mqtt' }], 'Petstore');

        expect(app.workspaceTabController.createRunnerTab).toHaveBeenCalledWith({
            name: 'Petstore',
            requests: [{ collection, endpoint: http }]
        });
    });

    test('tells the user when nothing can be run', async () => {
        const controller = makeController();
        app.workspaceTabController = { createRunnerTab: jest.fn() };

        await controller.handleRunRequests(collection, [{ id: 'e2', protocol: 'mqtt' }], 'Petstore');

        expect(app.workspaceTabController.createRunnerTab).not.toHaveBeenCalled();
        expect(toast.info).toHaveBeenCalledTimes(1);
    });
});
