jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }
}));

import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { endpointKey } from '../../src/modules/collections/collectionTree.js';
import { toast } from '../../src/modules/ui/Toast.js';

const HANDLER_KEYS = [
    'handleNewCollection', 'handleEndpointClick', 'handleContextMenu', 'handleFolderContextMenu',
    'handleEndpointContextMenu', 'handleEmptySpaceContextMenu', 'handleTogglePinned'
];

function makeController(collections) {
    const controller = Object.create(CollectionController.prototype);
    controller.searchQuery = '';
    controller.allCollections = collections;
    controller.loadErrors = [];
    controller._pinnedRequests = null;
    controller.gitStatus = { c1: { changes: 1, requests: {} } };
    controller.gitStatusInFlight = false;
    controller.repository = {
        getPinnedRequests: jest.fn().mockResolvedValue({ [endpointKey('c1', 'e1')]: true }),
        togglePinnedRequest: jest.fn(),
        getLoadErrors: jest.fn().mockResolvedValue([]),
        gitStatus: jest.fn().mockResolvedValue({})
    };
    controller.renderer = { renderCollections: jest.fn(), renderLoadErrors: jest.fn(), updatePinnedState: jest.fn(), updateGitStatus: jest.fn() };
    for (const key of HANDLER_KEYS) {
        controller[key] = jest.fn();
    }
    return controller;
}

const COLLECTIONS = [{ id: 'c1', name: 'Petstore', endpoints: [{ id: 'e1', name: 'List pets', path: '/pets' }], folders: [] }];

describe('CollectionController.renderCollections', () => {
    beforeEach(() => jest.clearAllMocks());

    test('passes the collections, handlers, expansion flag, options and pinned map to the renderer', async () => {
        const controller = makeController(COLLECTIONS);

        await controller.renderCollections(COLLECTIONS, true);

        const [collections, handlers, preserve, options, pinned] = controller.renderer.renderCollections.mock.calls[0];
        expect(collections).toEqual(COLLECTIONS);
        expect(Object.keys(handlers).sort()).toEqual([
            'onContextMenu', 'onEmptySpaceContextMenu', 'onEmptyStateActions', 'onEndpointClick',
            'onEndpointContextMenu', 'onFolderContextMenu', 'onTogglePinned'
        ]);
        expect(Object.keys(handlers.onEmptyStateActions).sort()).toEqual(['import-collection', 'import-curl', 'new-collection', 'open-existing']);
        expect(preserve).toBe(true);
        expect(options).toEqual({ showSearchEmptyState: false, expandSearchResults: false });
        expect(pinned).toEqual({ [endpointKey('c1', 'e1')]: true });
        expect(controller.renderer.renderLoadErrors).toHaveBeenCalledWith([], expect.objectContaining({
            onLocate: expect.any(Function), onRemove: expect.any(Function), onRetry: expect.any(Function)
        }));
        expect(controller.renderer.updateGitStatus).toHaveBeenCalledWith(controller.gitStatus);
    });

    test('a search drops expansion-state preservation, expands results and hides load errors', async () => {
        const controller = makeController(COLLECTIONS);
        controller.searchQuery = 'pets';
        controller.loadErrors = [{ id: 'x', path: '/x', message: 'gone' }];

        await controller.renderCollections(COLLECTIONS, true);

        const [, , preserve, options] = controller.renderer.renderCollections.mock.calls[0];
        expect(preserve).toBe(false);
        expect(options).toEqual({ showSearchEmptyState: true, expandSearchResults: true });
        expect(controller.renderer.renderLoadErrors.mock.calls[0][0]).toEqual([]);
    });

    test('caches the pinned map across renders', async () => {
        const controller = makeController(COLLECTIONS);

        await controller.renderCollections(COLLECTIONS);
        await controller.renderCollections(COLLECTIONS);

        expect(controller.repository.getPinnedRequests).toHaveBeenCalledTimes(1);
    });
});

describe('CollectionController._reload', () => {
    test('loads, refreshes errors, renders and notifies listeners', async () => {
        const controller = makeController([]);
        controller.service = { loadCollections: jest.fn().mockResolvedValue(COLLECTIONS) };
        controller._refreshLoadErrors = jest.fn().mockResolvedValue(undefined);
        controller.renderCollections = jest.fn().mockResolvedValue(undefined);
        const listener = jest.fn();
        controller._collectionEvents = { emit: listener };

        await expect(controller.loadCollectionsWithExpansionState()).resolves.toEqual(COLLECTIONS);

        expect(controller.allCollections).toEqual(COLLECTIONS);
        expect(controller.renderCollections).toHaveBeenCalledWith(COLLECTIONS, true);
        expect(listener).toHaveBeenCalledWith(COLLECTIONS);
        expect(controller.repository.gitStatus).toHaveBeenCalledTimes(1);
    });

    test('returns an empty list when loading fails', async () => {
        const controller = makeController([]);
        controller.service = { loadCollections: jest.fn().mockRejectedValue(new Error('disk')) };

        await expect(controller.loadCollections()).resolves.toEqual([]);
    });
});

describe('CollectionController pin and load-error bookkeeping', () => {
    test('handleTogglePinned updates the cached map and the renderer', async () => {
        const controller = makeController(COLLECTIONS);
        controller.handleTogglePinned = CollectionController.prototype.handleTogglePinned;
        controller.repository.togglePinnedRequest.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const collection = COLLECTIONS[0];
        const endpoint = collection.endpoints[0];
        const key = endpointKey('c1', 'e1');

        await controller.handleTogglePinned(collection, endpoint);
        expect(controller._pinnedRequests).toEqual({});
        expect(controller.renderer.updatePinnedState).toHaveBeenLastCalledWith('c1', 'e1', false, {});

        await controller.handleTogglePinned(collection, endpoint);
        expect(controller._pinnedRequests).toEqual({ [key]: true });
        expect(controller.renderer.updatePinnedState).toHaveBeenLastCalledWith('c1', 'e1', true, { [key]: true });
    });

    test('_refreshLoadErrors toasts only when the set of errors changes', async () => {
        const controller = makeController([]);
        const errors = [{ id: 'x', path: '/x', message: 'gone' }];
        controller.repository.getLoadErrors.mockResolvedValue(errors);

        await controller._refreshLoadErrors();
        await controller._refreshLoadErrors();
        expect(toast.warning).toHaveBeenCalledTimes(1);
        expect(toast.warning.mock.calls[0][0]).toContain('1 collection');
        expect(controller.loadErrors).toBe(errors);

        controller.repository.getLoadErrors.mockResolvedValue([]);
        await controller._refreshLoadErrors();
        expect(toast.warning).toHaveBeenCalledTimes(1);
        expect(controller.loadErrors).toEqual([]);
    });
});
