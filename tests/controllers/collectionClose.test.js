/* global document */
import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

/**
 * A collection opened in place lives in a directory the app does not own —
 * usually a git checkout. Closing it must be reversible: nothing on disk may
 * change, and the credentials that live outside the directory must survive.
 */
describe('CollectionController close vs delete', () => {
    let controller;
    let service;
    let variableService;
    let confirmDialog;

    const collection = (linked) => ({ id: 'c1', name: 'Petstore', linked });

    beforeEach(() => {
        document.body.innerHTML = '';
        service = {
            closeCollection: jest.fn().mockResolvedValue(true),
            deleteCollection: jest.fn().mockResolvedValue(true)
        };
        variableService = { cleanupCollectionVariables: jest.fn().mockResolvedValue(undefined) };
        confirmDialog = { show: jest.fn().mockResolvedValue(true) };

        controller = Object.create(CollectionController.prototype);
        controller.service = service;
        controller.variableService = variableService;
        controller.confirmDialog = confirmDialog;
        controller.loadCollections = jest.fn().mockResolvedValue(undefined);
        controller.closeTabsForCollection = jest.fn().mockResolvedValue(undefined);
    });

    describe('the context menu', () => {
        beforeEach(() => {
            controller.contextMenu = { show: jest.fn() };
        });

        const itemsFor = (linked) => {
            controller.handleContextMenu(
                { preventDefault: jest.fn(), stopPropagation: jest.fn() },
                collection(linked)
            );
            return controller.contextMenu.show.mock.calls.at(-1)[1];
        };

        test('an app-managed collection offers Delete and not Close', () => {
            const keys = itemsFor(false).map(item => item.translationKey);

            expect(keys).toContain('context_menu.delete_collection');
            expect(keys).not.toContain('context_menu.close_collection');
        });

        test('a linked collection offers Close and not Delete', () => {
            const keys = itemsFor(true).map(item => item.translationKey);

            expect(keys).toContain('context_menu.close_collection');
            expect(keys).not.toContain('context_menu.delete_collection');
        });

        test('Close is not styled as a destructive action', () => {
            const close = itemsFor(true).find(
                item => item.translationKey === 'context_menu.close_collection'
            );

            expect(close.className).toBeUndefined();
        });
    });

    describe('handleClose', () => {
        /**
         * cleanupCollectionVariables routes to collection_save_variables, which
         * rewrites the collection on disk — blanking variables.yaml in the
         * user's working copy. Close must never reach it.
         */
        test('does not touch the collection variables on disk', async () => {
            await controller.handleClose(collection(true));

            expect(variableService.cleanupCollectionVariables).not.toHaveBeenCalled();
        });

        test('does not delete anything', async () => {
            await controller.handleClose(collection(true));

            expect(service.deleteCollection).not.toHaveBeenCalled();
            expect(service.closeCollection).toHaveBeenCalledWith('c1');
        });

        test('closes the collection tabs and refreshes the list', async () => {
            await controller.handleClose(collection(true));

            expect(controller.closeTabsForCollection).toHaveBeenCalledWith('c1');
            expect(controller.loadCollections).toHaveBeenCalled();
        });

        test('does nothing at all when the user cancels', async () => {
            confirmDialog.show.mockResolvedValue(false);

            await controller.handleClose(collection(true));

            expect(service.closeCollection).not.toHaveBeenCalled();
            expect(controller.loadCollections).not.toHaveBeenCalled();
        });

        test('is not offered as a dangerous confirmation', async () => {
            await controller.handleClose(collection(true));

            const options = confirmDialog.show.mock.calls[0][1];
            expect(options.dangerous).toBeFalsy();
        });
    });
});
