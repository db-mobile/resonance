/* global window */
import { CollectionService } from '../../src/modules/services/CollectionService.js';

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

describe('CollectionService exports, opening and row saves', () => {
    let repository;
    let statusDisplay;
    let service;

    beforeEach(() => {
        repository = {
            openExisting: jest.fn().mockResolvedValue({ opened: [{ id: 'a' }, { id: 'b' }] }),
            savePersistedPathParams: jest.fn().mockResolvedValue(undefined),
            savePersistedQueryParams: jest.fn().mockResolvedValue(undefined),
            savePersistedHeaders: jest.fn().mockResolvedValue(undefined)
        };
        statusDisplay = { update: jest.fn() };
        service = new CollectionService(repository, {}, statusDisplay);
        window.backendAPI = {
            collections: {
                exportOpenApi: jest.fn().mockResolvedValue({ success: true }),
                exportPostman: jest.fn().mockResolvedValue({ success: true, skipped: { count: 2 } })
            }
        };
    });

    afterEach(() => {
        delete window.backendAPI;
    });

    describe('exportCollectionAsOpenApi / exportCollectionAsPostman', () => {
        test('reports progress and success, including skipped items', async () => {
            const openApi = await service.exportCollectionAsOpenApi('c1', 'yaml');
            const postman = await service.exportCollectionAsPostman('c1');

            expect(window.backendAPI.collections.exportOpenApi).toHaveBeenCalledWith('c1', 'yaml');
            expect(window.backendAPI.collections.exportPostman).toHaveBeenCalledWith('c1');
            expect(openApi).toEqual({ success: true });
            expect(postman).toEqual({ success: true, skipped: { count: 2 } });
            expect(statusDisplay.update.mock.calls).toEqual([
                ['Exporting collection...', null],
                ['Collection exported successfully to YAML', null],
                ['Exporting collection...', null],
                ['Collection exported successfully to Postman (2 items skipped)', null]
            ]);
        });

        test('a cancelled export returns the cancelled shape', async () => {
            window.backendAPI.collections.exportOpenApi.mockResolvedValue({ cancelled: true });

            expect(await service.exportCollectionAsOpenApi('c1', 'json')).toEqual({ success: false, cancelled: true });
            expect(statusDisplay.update).toHaveBeenLastCalledWith('Export cancelled', null);
        });

        test('an unsuccessful result or a thrown error is reported and rethrown', async () => {
            window.backendAPI.collections.exportOpenApi.mockResolvedValue({ success: false });
            await expect(service.exportCollectionAsOpenApi('c1', 'json')).rejects.toThrow('Export failed');
            expect(statusDisplay.update).toHaveBeenLastCalledWith('Export error: Export failed', null);

            window.backendAPI.collections.exportPostman.mockRejectedValue(new Error('disk'));
            await expect(service.exportCollectionAsPostman('c1')).rejects.toThrow('disk');
            expect(statusDisplay.update).toHaveBeenLastCalledWith('Export error: disk', null);
        });
    });

    describe('openExistingCollection', () => {
        test('reports the opened count', async () => {
            const result = await service.openExistingCollection('/p');

            expect(result).toEqual({ opened: [{ id: 'a' }, { id: 'b' }] });
            expect(statusDisplay.update.mock.calls).toEqual([
                ['Opening collection...', null],
                ['Opened 2 collections', null]
            ]);
        });

        test('uses the singular and clears the status when nothing opened', async () => {
            repository.openExisting.mockResolvedValue({ opened: [{ id: 'a' }] });
            await service.openExistingCollection('/p');
            expect(statusDisplay.update).toHaveBeenLastCalledWith('Opened 1 collection', null);

            repository.openExisting.mockResolvedValue({ opened: [] });
            await service.openExistingCollection('/p');
            expect(statusDisplay.update).toHaveBeenLastCalledWith('', null);
        });

        test('wraps string and Error failures and clears the status', async () => {
            repository.openExisting.mockRejectedValue('plain failure');
            await expect(service.openExistingCollection('/p')).rejects.toThrow('plain failure');

            repository.openExisting.mockRejectedValue(new Error('typed'));
            await expect(service.openExistingCollection('/p')).rejects.toThrow('typed');
            expect(statusDisplay.update).toHaveBeenLastCalledWith('', null);
        });
    });

    describe('saveCurrent* rows', () => {
        const row = (key, value, enabled) => {
            const checkbox = enabled === undefined ? null : { checked: enabled };
            const cells = { '.key-input': { value: key }, '.value-input': { value }, '.row-enabled-checkbox': checkbox };
            return { querySelector: selector => cells[selector] };
        };
        const list = (...rows) => ({ querySelectorAll: () => rows });

        test('each saver parses its own list and persists through its repository method', async () => {
            const formElements = {
                pathParamsList: list(row(' id ', ' 7 ')),
                queryParamsList: list(row('q', 'x', false), row('', 'skipped')),
                headersList: list(row('Accept', '*/*', true))
            };

            await service.saveCurrentPathParams('c1', 'e1', formElements);
            await service.saveCurrentQueryParams('c1', 'e1', formElements);
            await service.saveCurrentHeaders('c1', 'e1', formElements);

            expect(repository.savePersistedPathParams).toHaveBeenCalledWith('c1', 'e1', [{ key: 'id', value: '7' }]);
            expect(repository.savePersistedQueryParams).toHaveBeenCalledWith('c1', 'e1', [{ key: 'q', value: 'x', enabled: false }]);
            expect(repository.savePersistedHeaders).toHaveBeenCalledWith('c1', 'e1', [{ key: 'Accept', value: '*/*', enabled: true }]);
        });

        test('a missing list or a repository failure is swallowed', async () => {
            repository.savePersistedHeaders.mockRejectedValue(new Error('x'));

            await expect(service.saveCurrentPathParams('c1', 'e1', {})).resolves.toBeUndefined();
            await expect(service.saveCurrentHeaders('c1', 'e1', { headersList: list() })).resolves.toBeUndefined();
        });

        test('the three savers stay reachable by name for dynamic callers', () => {
            for (const name of ['saveCurrentPathParams', 'saveCurrentQueryParams', 'saveCurrentHeaders']) {
                expect(typeof service[name]).toBe('function');
            }
        });
    });
});
