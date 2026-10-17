jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }
}));

import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { getCurrentEndpoint, setCurrentEndpoint } from '../../src/modules/state/currentEndpoint.js';

function makeController({ activeTabId = 't1' } = {}) {
    const controller = Object.create(WorkspaceTabController.prototype);
    controller.service = {
        getActiveTabId: jest.fn().mockResolvedValue(activeTabId),
        getActiveTab: jest.fn().mockResolvedValue({ id: activeTabId, name: 'Active' }),
        updateTab: jest.fn().mockResolvedValue(undefined),
        getAllTabs: jest.fn().mockResolvedValue([{ id: 't1' }])
    };
    controller.tabBar = { render: jest.fn(), updateTab: jest.fn() };
    controller.stateManager = { captureCurrentState: jest.fn().mockResolvedValue({ request: { url: 'https://x', protocol: 'graphql' } }) };
    controller.collectionRequests = {
        saveAllRequestModifications: jest.fn().mockResolvedValue(undefined),
        showSaveToCollectionDialog: jest.fn()
    };
    controller.markCurrentTabUnmodified = jest.fn().mockResolvedValue(undefined);
    return controller;
}

beforeEach(() => {
    jest.clearAllMocks();
    setCurrentEndpoint(null);
});

describe('WorkspaceTabController.saveTab', () => {
    test('a tab bound to an endpoint saves its modifications in place', async () => {
        const controller = makeController();

        await controller.saveTab({ id: 't1', name: 'Pets', endpoint: { collectionId: 'c1', endpointId: 'e1' } });

        expect(controller.collectionRequests.saveAllRequestModifications).toHaveBeenCalledWith('c1', 'e1');
        expect(controller.markCurrentTabUnmodified).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith('Saved "Pets"');
        expect(controller.collectionRequests.showSaveToCollectionDialog).not.toHaveBeenCalled();
    });

    test('an active unbound tab falls back to the current endpoint; a background one does not', async () => {
        const controller = makeController();
        setCurrentEndpoint({ collectionId: 'c1', endpointId: 'e9' });
        controller.collectionRequests.showSaveToCollectionDialog.mockResolvedValue(null);

        await controller.saveTab({ id: 't1', name: 'Active' });
        expect(controller.collectionRequests.saveAllRequestModifications).toHaveBeenCalledWith('c1', 'e9');

        await controller.saveTab({ id: 't2', name: 'Background' });
        expect(controller.collectionRequests.saveAllRequestModifications).toHaveBeenCalledTimes(1);
        expect(controller.collectionRequests.showSaveToCollectionDialog).toHaveBeenCalledTimes(1);
    });

    test('a runner tab and a controller without a collection port are ignored', async () => {
        const controller = makeController();

        await controller.saveTab({ id: 't1', name: 'Run', type: 'runner' });
        controller.collectionRequests = null;
        await controller.saveTab({ id: 't1', name: 'Pets', endpoint: { collectionId: 'c1', endpointId: 'e1' } });

        expect(toast.success).not.toHaveBeenCalled();
    });

    test('an unsaved tab is saved into a collection and rebound to the new endpoint', async () => {
        const controller = makeController();
        controller.collectionRequests.showSaveToCollectionDialog.mockResolvedValue({
            collectionId: 'c1', endpointId: 'e9', name: 'Named', collectionName: 'Petstore'
        });

        await controller.saveTab({ id: 't1', name: 'Untitled' });

        expect(controller.collectionRequests.showSaveToCollectionDialog).toHaveBeenCalledWith({ name: 'Untitled', url: 'https://x', protocol: 'graphql' });
        expect(getCurrentEndpoint()).toEqual({ collectionId: 'c1', endpointId: 'e9' });
        expect(controller.service.updateTab).toHaveBeenCalledWith('t1', {
            name: 'Named',
            endpoint: { collectionId: 'c1', endpointId: 'e9', protocol: 'graphql' }
        });
        expect(controller.markCurrentTabUnmodified).toHaveBeenCalledTimes(1);
        expect(controller.tabBar.render).toHaveBeenCalledWith([{ id: 't1' }], 't1');
        expect(toast.success).toHaveBeenCalledWith('Saved "Named" to Petstore');
    });

    test('a cancelled save dialog changes nothing', async () => {
        const controller = makeController();
        controller.collectionRequests.showSaveToCollectionDialog.mockResolvedValue(null);

        await controller.saveTab({ id: 't1', name: 'Untitled' });

        expect(controller.service.updateTab).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    test('a failure is reported as a toast', async () => {
        const controller = makeController();
        controller.collectionRequests.saveAllRequestModifications.mockRejectedValue(new Error('boom'));

        await controller.saveTab({ id: 't1', name: 'Pets', endpoint: { collectionId: 'c1', endpointId: 'e1' } });

        expect(toast.error).toHaveBeenCalledWith('Save failed: boom');
    });

    test('saveActiveTab saves whatever tab is active', async () => {
        const controller = makeController();
        controller.saveTab = jest.fn();

        await controller.saveActiveTab();

        expect(controller.saveTab).toHaveBeenCalledWith({ id: 't1', name: 'Active' });
    });
});
