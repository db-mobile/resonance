import { WorkspaceTabService } from '../../src/modules/services/WorkspaceTabService.js';
import { WorkspaceTabRepository } from '../../src/modules/storage/WorkspaceTabRepository.js';

describe('WorkspaceTabService.closeTabs', () => {
    let store;
    let backendAPI;
    let service;

    beforeEach(() => {
        store = {
            'workspace-tabs': [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }],
            'active-tab-id': 'b'
        };
        backendAPI = {
            store: {
                get: jest.fn(async (key) => store[key] ?? null),
                set: jest.fn(async (key, value) => { store[key] = value; })
            }
        };
        service = new WorkspaceTabService(new WorkspaceTabRepository(backendAPI), { update: jest.fn() });
    });

    test('removes all the tabs in one tab-list write', async () => {
        await service.getAllTabs();
        backendAPI.store.set.mockClear();

        await service.closeTabs(['a', 'c']);

        const tabWrites = backendAPI.store.set.mock.calls.filter(([key]) => key === 'workspace-tabs');
        expect(tabWrites).toHaveLength(1);
        expect(store['workspace-tabs'].map(tab => tab.id)).toEqual(['b', 'd']);
    });

    test('moves the active tab to the next surviving tab', async () => {
        const result = await service.closeTabs(['b', 'c']);

        expect(result.newActiveTabId).toBe('d');
    });

    test('falls back to the previous surviving tab when none follow', async () => {
        store['active-tab-id'] = 'd';

        const result = await service.closeTabs(['c', 'd']);

        expect(result.newActiveTabId).toBe('b');
    });

    test('refuses to close every tab', async () => {
        expect(await service.closeTabs(['a', 'b', 'c', 'd'])).toBeNull();
        expect(store['workspace-tabs']).toHaveLength(4);
    });
});
