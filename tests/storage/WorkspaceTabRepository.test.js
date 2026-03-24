import { WorkspaceTabRepository } from '../../src/modules/storage/WorkspaceTabRepository.js';

describe('WorkspaceTabRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn().mockResolvedValue()
            }
        };

        repository = new WorkspaceTabRepository(mockBackendAPI);
    });

    describe('getTabs', () => {
        test('should return tabs from storage', async () => {
            const tabs = [
                { id: 'tab-1', name: 'Request 1', request: { url: 'http://api.com' } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.getTabs();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Request 1');
        });

        test('should initialize with default tab when storage is empty', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getTabs();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('New Request');
            expect(result[0].id).toMatch(/^tab-/);
        });

        test('should initialize when data is not an array', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ invalid: 'data' });

            const result = await repository.getTabs();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('New Request');
        });

        test('should return shallow copy of array (callers should not mutate)', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test', request: { url: 'http://api.com' } }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result1 = await repository.getTabs();
            const result2 = await repository.getTabs();

            // Arrays are different instances (shallow copy)
            expect(result1).not.toBe(result2);
            // But tab objects are same references (memory optimization)
            expect(result1[0]).toBe(result2[0]);
        });

        test('should handle storage error gracefully', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Storage error'));

            const result = await repository.getTabs();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('New Request');
        });
    });

    describe('caching', () => {
        test('should cache tabs after first fetch', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test' }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            await repository.getTabs();
            await repository.getTabs();

            expect(mockBackendAPI.store.get).toHaveBeenCalledTimes(1);
        });
    });

    describe('saveTabs', () => {
        test('should save tabs to storage', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test' }];

            await repository.saveTabs(tabs);

            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('workspace-tabs', tabs);
        });

        test('should throw error if tabs is not an array', async () => {
            await expect(repository.saveTabs({ invalid: 'data' }))
                .rejects.toThrow('Tabs must be an array');
        });

        test('should update cache', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test' }];
            mockBackendAPI.store.get.mockResolvedValue([]);

            await repository.saveTabs(tabs);
            const result = await repository.getTabs();

            expect(result[0].name).toBe('Test');
            expect(mockBackendAPI.store.get).not.toHaveBeenCalled();
        });
    });

    describe('getActiveTabId', () => {
        test('should return active tab ID', async () => {
            mockBackendAPI.store.get.mockResolvedValue('tab-1');

            const result = await repository.getActiveTabId();

            expect(result).toBe('tab-1');
        });

        test('should return null when no active tab', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getActiveTabId();

            expect(result).toBeNull();
        });

        test('should cache active tab ID', async () => {
            mockBackendAPI.store.get.mockResolvedValue('tab-1');

            await repository.getActiveTabId();
            await repository.getActiveTabId();

            expect(mockBackendAPI.store.get).toHaveBeenCalledTimes(1);
        });

        test('should return null on error', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Error'));

            const result = await repository.getActiveTabId();

            expect(result).toBeNull();
        });
    });

    describe('setActiveTabId', () => {
        test('should set active tab ID', async () => {
            await repository.setActiveTabId('tab-2');

            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('active-tab-id', 'tab-2');
        });

        test('should update cache immediately', async () => {
            mockBackendAPI.store.get.mockResolvedValue('tab-1');

            await repository.setActiveTabId('tab-2');
            const result = await repository.getActiveTabId();

            expect(result).toBe('tab-2');
            // Should not call get since cache is updated
            expect(mockBackendAPI.store.get).not.toHaveBeenCalled();
        });
    });

    describe('getTabById', () => {
        test('should return tab by ID', async () => {
            const tabs = [
                { id: 'tab-1', name: 'First' },
                { id: 'tab-2', name: 'Second' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.getTabById('tab-2');

            expect(result.name).toBe('Second');
        });

        test('should return null for non-existent tab', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test' }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.getTabById('non-existent');

            expect(result).toBeNull();
        });

        test('should return direct reference (callers should not mutate)', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test', request: { url: 'http://api.com' } }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.getTabById('tab-1');
            const result2 = await repository.getTabById('tab-1');

            // Same reference for memory optimization
            expect(result).toBe(result2);
        });
    });

    describe('addTab', () => {
        test('should add new tab', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.addTab({ name: 'New Tab' });

            expect(result.name).toBe('New Tab');
            expect(result.id).toMatch(/^tab-/);
            expect(result.createdAt).toBeDefined();
        });

        test('should use provided ID if given', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.addTab({ id: 'custom-id', name: 'Custom' });

            expect(result.id).toBe('custom-id');
        });

        test('should merge with default tab structure', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.addTab({ name: 'Partial' });

            expect(result.request).toBeDefined();
            expect(result.request.method).toBe('GET');
            expect(result.response).toBeDefined();
        });
    });

    describe('updateTab', () => {
        test('should update existing tab', async () => {
            const tabs = [{ id: 'tab-1', name: 'Old Name', request: { url: '' } }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.updateTab('tab-1', { name: 'New Name' });

            expect(result.name).toBe('New Name');
            expect(result.lastModifiedAt).toBeDefined();
        });

        test('should return null for non-existent tab', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.updateTab('non-existent', { name: 'Test' });

            expect(result).toBeNull();
        });

        test('should deep merge request object', async () => {
            const tabs = [{
                id: 'tab-1',
                name: 'Test',
                request: { url: 'http://old.com', method: 'GET', headers: { 'X-Old': 'value' } }
            }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.updateTab('tab-1', {
                request: { url: 'http://new.com' }
            });

            expect(result.request.url).toBe('http://new.com');
            expect(result.request.method).toBe('GET'); // Preserved
        });

        test('should completely replace response object', async () => {
            const tabs = [{
                id: 'tab-1',
                name: 'Test',
                response: { data: 'old', status: 200 }
            }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.updateTab('tab-1', {
                response: { data: 'new', status: 201 }
            });

            expect(result.response.data).toBe('new');
            expect(result.response.status).toBe(201);
        });

        test('should preserve tab ID', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test' }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.updateTab('tab-1', { id: 'new-id', name: 'Updated' });

            expect(result.id).toBe('tab-1');
        });
    });

    describe('deleteTab', () => {
        test('should delete tab', async () => {
            const tabs = [
                { id: 'tab-1', name: 'First' },
                { id: 'tab-2', name: 'Second' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.deleteTab('tab-1');

            expect(result).toBe(true);
        });

        test('should return false for non-existent tab', async () => {
            const tabs = [{ id: 'tab-1', name: 'Test' }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            const result = await repository.deleteTab('non-existent');

            expect(result).toBe(false);
        });

        test('should create default tab when deleting last tab', async () => {
            const tabs = [{ id: 'tab-1', name: 'Only Tab' }];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            await repository.deleteTab('tab-1');

            // Verify a new default tab was created
            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1]).toHaveLength(1);
            expect(setCall[1][0].name).toBe('New Request');
        });
    });

    describe('reorderTabs', () => {
        test('should reorder tabs based on ID order', async () => {
            const tabs = [
                { id: 'tab-1', name: 'First' },
                { id: 'tab-2', name: 'Second' },
                { id: 'tab-3', name: 'Third' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            await repository.reorderTabs(['tab-3', 'tab-1', 'tab-2']);

            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1][0].id).toBe('tab-3');
            expect(setCall[1][1].id).toBe('tab-1');
            expect(setCall[1][2].id).toBe('tab-2');
        });

        test('should filter out non-existent tab IDs', async () => {
            const tabs = [
                { id: 'tab-1', name: 'First' },
                { id: 'tab-2', name: 'Second' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            await repository.reorderTabs(['tab-2', 'non-existent', 'tab-1']);

            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1]).toHaveLength(2);
        });
    });

    describe('clearAllTabs', () => {
        test('should clear all tabs and create default', async () => {
            const tabs = [
                { id: 'tab-1', name: 'First' },
                { id: 'tab-2', name: 'Second' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(tabs);

            await repository.clearAllTabs();

            // First call saves tabs, second sets active tab
            expect(mockBackendAPI.store.set).toHaveBeenCalledTimes(2);
            const tabsCall = mockBackendAPI.store.set.mock.calls[0];
            expect(tabsCall[1]).toHaveLength(1);
            expect(tabsCall[1][0].name).toBe('New Request');
        });

        test('should set new default tab as active', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            await repository.clearAllTabs();

            const activeTabCall = mockBackendAPI.store.set.mock.calls[1];
            expect(activeTabCall[0]).toBe('active-tab-id');
            expect(activeTabCall[1]).toMatch(/^tab-/);
        });
    });

    describe('_createDefaultTab', () => {
        test('should create tab with default structure', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getTabs();
            const defaultTab = result[0];

            expect(defaultTab.id).toMatch(/^tab-/);
            expect(defaultTab.name).toBe('New Request');
            expect(defaultTab.isModified).toBe(false);
            expect(defaultTab.request.method).toBe('GET');
            expect(defaultTab.request.url).toBe('');
            expect(defaultTab.response.data).toBeNull();
            expect(defaultTab.endpoint).toBeNull();
        });
    });
});
