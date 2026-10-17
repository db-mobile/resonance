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
            savePersistedHeaders: jest.fn().mockResolvedValue(undefined),
            exportOpenApi: jest.fn().mockResolvedValue({ success: true }),
            exportPostman: jest.fn().mockResolvedValue({ success: true, skipped: { count: 2 } })
        };
        statusDisplay = { update: jest.fn() };
        service = new CollectionService(repository, {}, statusDisplay);
    });

    describe('exportCollectionAsOpenApi / exportCollectionAsPostman', () => {
        test('reports progress and success, including skipped items', async () => {
            const openApi = await service.exportCollectionAsOpenApi('c1', 'yaml');
            const postman = await service.exportCollectionAsPostman('c1');

            expect(repository.exportOpenApi).toHaveBeenCalledWith('c1', 'yaml');
            expect(repository.exportPostman).toHaveBeenCalledWith('c1');
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
            repository.exportOpenApi.mockResolvedValue({ cancelled: true });

            expect(await service.exportCollectionAsOpenApi('c1', 'json')).toEqual({ success: false, cancelled: true });
            expect(statusDisplay.update).toHaveBeenLastCalledWith('Export cancelled', null);
        });

        test('an unsuccessful result or a thrown error is reported and rethrown', async () => {
            repository.exportOpenApi.mockResolvedValue({ success: false });
            await expect(service.exportCollectionAsOpenApi('c1', 'json')).rejects.toThrow('Export failed');
            expect(statusDisplay.update).toHaveBeenLastCalledWith('Export error: Export failed', null);

            repository.exportPostman.mockRejectedValue(new Error('disk'));
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

    describe('data-only row saves', () => {
        test('each saver persists the rows it is given through its repository method', async () => {
            await service.savePathParams('c1', 'e1', [{ key: 'id', value: '7' }]);
            await service.saveQueryParams('c1', 'e1', [{ key: 'q', value: 'x', enabled: false }]);
            await service.saveHeaders('c1', 'e1', [{ key: 'Accept', value: '*/*', enabled: true }]);

            expect(repository.savePersistedPathParams).toHaveBeenCalledWith('c1', 'e1', [{ key: 'id', value: '7' }]);
            expect(repository.savePersistedQueryParams).toHaveBeenCalledWith('c1', 'e1', [{ key: 'q', value: 'x', enabled: false }]);
            expect(repository.savePersistedHeaders).toHaveBeenCalledWith('c1', 'e1', [{ key: 'Accept', value: '*/*', enabled: true }]);
        });

        test('a repository failure is swallowed', async () => {
            repository.savePersistedHeaders.mockRejectedValue(new Error('x'));

            await expect(service.saveHeaders('c1', 'e1', [])).resolves.toBeUndefined();
        });

        test('saveBodyState writes the state and swallows failures', async () => {
            repository.saveBodyState = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
            const state = { modifiedBody: '{}', formBodyData: null, graphqlData: null };

            await expect(service.saveBodyState('c1', 'e1', state)).resolves.toBeUndefined();
            await service.saveBodyState('c1', 'e1', state);

            expect(repository.saveBodyState).toHaveBeenLastCalledWith('c1', 'e1', state);
        });
    });
});
