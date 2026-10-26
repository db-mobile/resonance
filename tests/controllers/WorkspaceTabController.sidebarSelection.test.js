/* global document */
import { WorkspaceTabController } from '../../src/modules/controllers/WorkspaceTabController.js';
import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

const collections = [
    { id: 'c1', name: 'First API', endpoints: [{ id: 'e1', name: 'First', method: 'GET', path: '/first' }] },
    { id: 'c2', name: 'Second API', endpoints: [{ id: 'e1', name: 'Second', method: 'GET', path: '/second' }] }
];
const selectedRows = () => [...document.querySelectorAll('.endpoint-item.active')]
    .map(row => `${row.dataset.collectionId}/${row.dataset.endpointId}`);

describe('workspace tab sidebar selection', () => {
    let controller;
    let renderer;
    let service;
    let activeTabId;
    let tabs;

    beforeEach(async () => {
        document.body.innerHTML = `
            <div id="collections-list"></div>
            <main id="main-content-area">
                <section class="request-builder"></section>
                <div class="request-split"></div>
            </main>`;
        renderer = new CollectionRenderer('collections-list');
        await renderer.renderCollections(collections);
        renderer.setActiveEndpoint('c1', 'e1');

        tabs = [
            { id: 'first', type: 'request', endpoint: { collectionId: 'c1', endpointId: 'e1' } },
            { id: 'second', type: 'request', endpoint: { collectionId: 'c2', endpointId: 'e1' } },
            { id: 'blank', type: 'request', endpoint: null },
            { id: 'runner', type: 'runner', endpoint: null }
        ];
        activeTabId = 'first';
        service = {
            initialize: async () => ({ tabs, activeTabId }),
            getActiveTabId: async () => activeTabId,
            getAllTabs: async () => tabs,
            switchTab: async id => {
                const tab = tabs.find(item => item.id === id);
                if (tab) { activeTabId = id; }
                return tab;
            },
            closeTab: async id => {
                tabs = tabs.filter(tab => tab.id !== id);
                if (activeTabId === id) { activeTabId = tabs[0].id; }
                return { newActiveTabId: activeTabId };
            },
            createTab: async () => {
                const tab = { id: 'new', type: 'request', endpoint: null };
                tabs.push(tab);
                return tab;
            }
        };
        const collectionController = Object.create(CollectionController.prototype);
        collectionController.renderer = renderer;
        controller = new WorkspaceTabController(service,
            { render: jest.fn(), setActiveTab: jest.fn() },
            { restoreTabState: jest.fn().mockResolvedValue(undefined) },
            { showContainer: jest.fn(), removeContainer: jest.fn() },
            { collectionRequests: collectionController });
        controller._saveCurrentTabState = jest.fn().mockResolvedValue(undefined);
        controller.runnerControllers.set('runner', {});
    });

    test('switching tabs highlights the active request in its own collection', async () => {
        await controller.switchTab('second');
        expect(selectedRows()).toEqual(['c2/e1']);

        await controller.switchTab('first');
        expect(selectedRows()).toEqual(['c1/e1']);
    });

    test.each(['blank', 'runner'])('the %s tab clears the highlight and switching back restores it', async tabId => {
        await controller.switchTab(tabId);
        expect(selectedRows()).toEqual([]);

        await controller.switchTab('first');
        expect(selectedRows()).toEqual(['c1/e1']);
    });

    test('creating a blank tab clears the previously selected request', async () => {
        await controller.createNewTab();
        expect(selectedRows()).toEqual([]);
    });

    test('closing the active tab highlights its successor', async () => {
        await controller.switchTab('second');
        renderer.setActiveEndpoint('c2', 'e1');

        await controller.closeTab('second');
        expect(selectedRows()).toEqual(['c1/e1']);
    });

    test('initial selection survives collections loading after tab restoration', async () => {
        document.getElementById('collections-list').replaceChildren();
        renderer.clearActiveEndpoint();
        activeTabId = 'second';

        await controller.initialize();
        await renderer.renderCollections(collections);

        expect(selectedRows()).toEqual(['c2/e1']);
    });

    test('filtering out the selected request does not lose its selection when the filter clears', async () => {
        await controller.switchTab('second');
        await renderer.renderCollections([collections[0]]);
        expect(selectedRows()).toEqual([]);

        await renderer.renderCollections(collections);
        expect(selectedRows()).toEqual(['c2/e1']);
    });

    test('pinned and collection copies highlight the same active request', async () => {
        await renderer.renderCollections(collections, {}, false, {}, { c2_e1: true });

        await controller.switchTab('second');
        expect(selectedRows()).toEqual(['c2/e1', 'c2/e1']);
    });

    test('pinning the selected request preserves the highlight on both copies', () => {
        renderer.updatePinnedState('c1', 'e1', true, { c1_e1: true });
        expect(selectedRows()).toEqual(['c1/e1', 'c1/e1']);
    });
});
