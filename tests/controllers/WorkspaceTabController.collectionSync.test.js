import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';

function makeController(tabs) {
    const controller = Object.create(WorkspaceTabController.prototype);
    controller.service = {
        getAllTabs: jest.fn().mockResolvedValue(tabs),
        getActiveTabId: jest.fn().mockResolvedValue('t1'),
        updateTab: jest.fn().mockResolvedValue(undefined)
    };
    controller.tabBar = { updateTab: jest.fn() };
    controller.closeTabs = jest.fn().mockResolvedValue(undefined);
    return controller;
}

describe('WorkspaceTabController collection sync', () => {
    test('closeTabsForCollection closes every tab of that collection and swallows failures', async () => {
        const controller = makeController([{ id: 't1', collectionId: 'c1' }, { id: 't2', collectionId: 'c2' }, { id: 't3', collectionId: 'c1' }]);

        await controller.closeTabsForCollection('c1');
        expect(controller.closeTabs).toHaveBeenCalledWith(['t1', 't3']);

        controller.service.getAllTabs.mockRejectedValue(new Error('x'));
        await expect(controller.closeTabsForCollection('c1')).resolves.toBeUndefined();
    });

    test('renameTabsForEndpoint renames only the tabs showing that endpoint', async () => {
        const controller = makeController([
            { id: 't1', endpoint: { collectionId: 'c1', endpointId: 'e1' } },
            { id: 't2', endpoint: { collectionId: 'c1', endpointId: 'e2' } },
            { id: 't3' }
        ]);

        await controller.renameTabsForEndpoint('c1', 'e1', 'Fetch');

        expect(controller.service.updateTab).toHaveBeenCalledTimes(1);
        expect(controller.service.updateTab).toHaveBeenCalledWith('t1', { name: 'Fetch' });
        expect(controller.tabBar.updateTab).toHaveBeenCalledWith('t1', { name: 'Fetch' });
    });

    test('updateActiveTabRequest writes the request onto the active tab only', async () => {
        const controller = makeController([]);

        await controller.updateActiveTabRequest({ url: 'https://x' });
        expect(controller.service.updateTab).toHaveBeenCalledWith('t1', { request: { url: 'https://x' } });

        controller.service.getActiveTabId.mockResolvedValue(null);
        await controller.updateActiveTabRequest({ url: 'https://y' });
        expect(controller.service.updateTab).toHaveBeenCalledTimes(1);
    });
});
