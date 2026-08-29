import { WorkspaceTabRepository } from '../../src/modules/storage/WorkspaceTabRepository.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WorkspaceTabRepository write ordering and read resilience', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn().mockResolvedValue([{ id: 'tab-1', name: 'One' }]),
                set: jest.fn().mockResolvedValue(undefined)
            }
        };
        repository = new WorkspaceTabRepository(mockBackendAPI);
    });

    test('a later write never starts before an earlier slow write finishes', async () => {
        await repository.getTabs();

        let releaseFirstWrite;
        const started = [];
        mockBackendAPI.store.set
            .mockImplementationOnce((key, value) => {
                started.push(value);
                return new Promise((resolve) => {
                    releaseFirstWrite = resolve;
                });
            })
            .mockImplementation((key, value) => {
                started.push(value);
                return Promise.resolve();
            });

        await repository.updateTab('tab-1', { name: 'First' });
        await repository.updateTab('tab-1', { name: 'Second' });
        await flushMicrotasks();

        expect(started).toHaveLength(1);
        expect(started[0][0].name).toBe('First');

        releaseFirstWrite();
        await flushMicrotasks();

        expect(started).toHaveLength(2);
        expect(started[1][0].name).toBe('Second');
    });

    test('a transient read failure returns a default tab without overwriting the store', async () => {
        mockBackendAPI.store.get.mockRejectedValueOnce(new Error('store locked'));

        const tabs = await repository.getTabs();

        expect(tabs).toHaveLength(1);
        expect(tabs[0].name).toBe('New Request');
        expect(mockBackendAPI.store.set).not.toHaveBeenCalled();
    });

    test('an empty store still initializes and persists default tabs', async () => {
        mockBackendAPI.store.get.mockResolvedValueOnce(null);

        const tabs = await repository.getTabs();

        expect(tabs).toHaveLength(1);
        expect(mockBackendAPI.store.set).toHaveBeenCalledTimes(1);
        expect(mockBackendAPI.store.set).toHaveBeenCalledWith('workspace-tabs', tabs);
    });

    test('response truncation only runs when an update carries a response', async () => {
        await repository.getTabs();
        const bigData = { blob: 'x'.repeat(10) };
        await repository.updateTab('tab-1', { response: { data: bigData } });
        const stringifySpy = jest.spyOn(JSON, 'stringify');

        await repository.updateTab('tab-1', { name: 'Renamed' });

        const stringifiedBig = stringifySpy.mock.calls.some(([value]) => value === bigData);
        expect(stringifiedBig).toBe(false);
        stringifySpy.mockRestore();
    });
});
