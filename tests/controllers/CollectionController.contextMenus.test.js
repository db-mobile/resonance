import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { endpointKey } from '../../src/modules/collections/collectionTree.js';

const ROUTED = [
    'handleNewRequest', 'handleNewFolder', 'handleRunRequests', 'handleVariables', 'handleCollectionAuth',
    'handleExportOpenApiJson', 'handleExportOpenApiYaml', 'handleExportPostman', 'handleGenerateDocumentation',
    'handleRename', 'handleReveal', 'handleClose', 'handleDelete', 'handleTogglePinned', 'handleRenameRequest', 'handleDuplicateRequest',
    'handleMoveRequest', 'handleDeleteRequest', 'handleRenameFolder', 'handleFolderAuth', 'handleDeleteFolder',
    'handleNewCollection', 'handleNewRequestInEmptySpace'
];

function makeController(pinned = {}) {
    const controller = Object.create(CollectionController.prototype);
    controller.contextMenu = { show: jest.fn() };
    controller._pinnedRequests = pinned;
    for (const name of ROUTED) {
        controller[name] = jest.fn();
    }
    return controller;
}

const event = () => ({ preventDefault: jest.fn(), stopPropagation: jest.fn() });
const items = (controller) => controller.contextMenu.show.mock.calls.at(-1)[1];
const keysOf = (controller) => items(controller).map((item) => item.translationKey);
const click = (controller, key) => items(controller).find((item) => item.translationKey === key).onClick();

const collection = {
    id: 'c1', name: 'Petstore', linked: false,
    endpoints: [{ id: 'e1', name: 'List', path: '/pets', protocol: 'http' }],
    folders: [{ id: 'f1', name: 'Admin', endpoints: [{ id: 'e2', path: '/admin', protocol: 'http' }], folders: [] }]
};
const endpoint = collection.endpoints[0];
const folder = collection.folders[0];

describe('collection context menu', () => {
    test('lists every collection action in order and routes each click', () => {
        const controller = makeController();
        controller.handleContextMenu(event(), collection);

        expect(keysOf(controller)).toEqual([
            'context_menu.new_request', 'context_menu.new_folder', 'context_menu.run_collection', 'context_menu.manage_variables',
            'context_menu.edit_auth', 'context_menu.export_openapi_json', 'context_menu.export_openapi_yaml', 'context_menu.export_postman',
            'context_menu.generate_docs', 'context_menu.rename_collection', 'context_menu.show_in_file_manager', 'context_menu.delete_collection'
        ]);

        click(controller, 'context_menu.new_request');
        expect(controller.handleNewRequest).toHaveBeenCalledWith(collection);
        click(controller, 'context_menu.new_folder');
        expect(controller.handleNewFolder).toHaveBeenCalledWith(collection, null);
        click(controller, 'context_menu.run_collection');
        expect(controller.handleRunRequests).toHaveBeenCalledWith(collection, expect.arrayContaining([endpoint]), 'Petstore');
        click(controller, 'context_menu.edit_auth');
        expect(controller.handleCollectionAuth).toHaveBeenCalledWith(collection);
        click(controller, 'context_menu.export_postman');
        expect(controller.handleExportPostman).toHaveBeenCalledWith(collection);
        click(controller, 'context_menu.show_in_file_manager');
        expect(controller.handleReveal).toHaveBeenCalledWith(collection);
        click(controller, 'context_menu.delete_collection');
        expect(controller.handleDelete).toHaveBeenCalledWith(collection);
    });
});

describe('request context menu', () => {
    test('offers Pin, Rename, Duplicate, Move (when folders exist) and Delete', async () => {
        const controller = makeController();
        await controller.handleEndpointContextMenu(event(), collection, endpoint);

        expect(keysOf(controller)).toEqual([
            'context_menu.pin_request', 'context_menu.rename_request', 'context_menu.duplicate_request',
            'context_menu.move_request', 'context_menu.delete_request'
        ]);
        click(controller, 'context_menu.pin_request');
        expect(controller.handleTogglePinned).toHaveBeenCalledWith(collection, endpoint);
        click(controller, 'context_menu.move_request');
        expect(controller.handleMoveRequest).toHaveBeenCalledWith(collection, endpoint);
        click(controller, 'context_menu.delete_request');
        expect(controller.handleDeleteRequest).toHaveBeenCalledWith(collection, endpoint);
        expect(items(controller).at(-1).className).toBe('context-menu-delete');
    });

    test('shows Unpin for a pinned request and no Move entry without folders', async () => {
        const controller = makeController({ [endpointKey('c1', 'e1')]: true });
        await controller.handleEndpointContextMenu(event(), { ...collection, folders: [] }, endpoint);

        expect(keysOf(controller)).toEqual([
            'context_menu.unpin_request', 'context_menu.rename_request', 'context_menu.duplicate_request', 'context_menu.delete_request'
        ]);
    });
});

describe('folder and empty-space context menus', () => {
    test('the folder menu routes to folder-scoped actions', () => {
        const controller = makeController();
        controller.handleFolderContextMenu(event(), collection, folder);

        expect(keysOf(controller)).toEqual([
            'context_menu.new_request', 'context_menu.new_subfolder', 'context_menu.rename_folder',
            'context_menu.run_folder', 'context_menu.edit_auth', 'context_menu.delete_folder'
        ]);
        click(controller, 'context_menu.new_request');
        expect(controller.handleNewRequest).toHaveBeenCalledWith(collection, 'f1');
        click(controller, 'context_menu.new_subfolder');
        expect(controller.handleNewFolder).toHaveBeenCalledWith(collection, 'f1');
        click(controller, 'context_menu.run_folder');
        expect(controller.handleRunRequests).toHaveBeenCalledWith(collection, expect.any(Array), 'Petstore / Admin');
        click(controller, 'context_menu.edit_auth');
        expect(controller.handleFolderAuth).toHaveBeenCalledWith(collection, folder);
    });

    test('the empty-space menu offers a new collection or request', () => {
        const controller = makeController();
        controller.handleEmptySpaceContextMenu(event());

        expect(keysOf(controller)).toEqual(['context_menu.new_collection', 'context_menu.new_request']);
        click(controller, 'context_menu.new_request');
        expect(controller.handleNewRequestInEmptySpace).toHaveBeenCalledTimes(1);
    });
});
