import { HistoryRepository } from '../../src/modules/storage/HistoryRepository.js';

describe('HistoryRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn().mockResolvedValue()
            },
            settings: {
                get: jest.fn().mockResolvedValue({})
            }
        };

        repository = new HistoryRepository(mockBackendAPI);
    });

    describe('getAll', () => {
        test('should return history entries sorted by timestamp descending', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://first.com' } },
                { id: 'h2', timestamp: 3000, request: { url: 'http://third.com' } },
                { id: 'h3', timestamp: 2000, request: { url: 'http://second.com' } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.getAll();

            expect(result[0].timestamp).toBe(3000);
            expect(result[1].timestamp).toBe(2000);
            expect(result[2].timestamp).toBe(1000);
        });

        test('should return empty array when no history', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getAll();

            expect(result).toEqual([]);
        });

        test('should initialize storage when data is not an array', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ invalid: 'data' });

            const result = await repository.getAll();

            expect(result).toEqual([]);
            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('requestHistory', []);
        });

        test('should return empty array on storage failure', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Storage error'));

            const result = await repository.getAll();

            expect(result).toEqual([]);
        });
    });

    describe('add', () => {
        test('should add new history entry at beginning', async () => {
            const existingHistory = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://old.com' } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(existingHistory);

            const newEntry = {
                id: 'h2',
                timestamp: 2000,
                request: { url: 'http://new.com' }
            };

            const result = await repository.add(newEntry);

            expect(result).toEqual(newEntry);
            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1][0].id).toBe('h2'); // New entry first
        });

        test('should limit history to MAX_HISTORY_ITEMS', async () => {
            const existingHistory = Array.from({ length: 100 }, (_, i) => ({
                id: `h${i}`,
                timestamp: i,
                request: { url: `http://test${i}.com` }
            }));
            mockBackendAPI.store.get.mockResolvedValue(existingHistory);

            await repository.add({ id: 'new', timestamp: 999, request: { url: 'http://new.com' } });

            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1]).toHaveLength(100); // Limited to 100
            expect(setCall[1][0].id).toBe('new'); // New entry first
        });

        test('should respect user-configured history limit', async () => {
            const existingHistory = Array.from({ length: 50 }, (_, i) => ({
                id: `h${i}`,
                timestamp: i,
                request: { url: `http://test${i}.com` }
            }));
            mockBackendAPI.store.get.mockResolvedValue(existingHistory);
            mockBackendAPI.settings.get.mockResolvedValue({ historyLimit: 20 });

            await repository.add({ id: 'new', timestamp: 999, request: { url: 'http://new.com' } });

            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1]).toHaveLength(20);
        });

        test('should handle empty history', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const newEntry = { id: 'h1', timestamp: 1000, request: { url: 'http://test.com' } };
            const result = await repository.add(newEntry);

            expect(result).toEqual(newEntry);
        });

        test('should throw error on save failure', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);
            mockBackendAPI.store.set.mockRejectedValue(new Error('Write failed'));

            await expect(repository.add({ id: 'h1' }))
                .rejects.toThrow('Failed to add history entry');
        });
    });

    describe('getById', () => {
        test('should return history entry by ID', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://first.com' } },
                { id: 'h2', timestamp: 2000, request: { url: 'http://second.com' } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.getById('h2');

            expect(result.request.url).toBe('http://second.com');
        });

        test('should return undefined for non-existent entry', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.getById('non-existent');

            expect(result).toBeUndefined();
        });

        test('should return undefined on error', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Error'));

            const result = await repository.getById('h1');

            expect(result).toBeUndefined();
        });
    });

    describe('delete', () => {
        test('should delete history entry by ID', async () => {
            const history = [
                { id: 'h1', timestamp: 1000 },
                { id: 'h2', timestamp: 2000 }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.delete('h1');

            expect(result).toBe(true);
            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1]).toHaveLength(1);
            expect(setCall[1][0].id).toBe('h2');
        });

        test('should throw error on delete failure', async () => {
            mockBackendAPI.store.get.mockResolvedValue([{ id: 'h1' }]);
            mockBackendAPI.store.set.mockRejectedValue(new Error('Delete failed'));

            await expect(repository.delete('h1'))
                .rejects.toThrow('Failed to delete history entry');
        });
    });

    describe('clear', () => {
        test('should clear all history', async () => {
            const result = await repository.clear();

            expect(result).toBe(true);
            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('requestHistory', []);
        });

        test('should throw error on clear failure', async () => {
            mockBackendAPI.store.set.mockRejectedValue(new Error('Clear failed'));

            await expect(repository.clear())
                .rejects.toThrow('Failed to clear history');
        });
    });

    describe('getByCollection', () => {
        test('should return history entries for specific collection', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { collectionId: 'col1', url: 'http://a.com' } },
                { id: 'h2', timestamp: 2000, request: { collectionId: 'col2', url: 'http://b.com' } },
                { id: 'h3', timestamp: 3000, request: { collectionId: 'col1', url: 'http://c.com' } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.getByCollection('col1');

            expect(result).toHaveLength(2);
            expect(result[0].request.collectionId).toBe('col1');
            expect(result[1].request.collectionId).toBe('col1');
        });

        test('should return empty array when no matches', async () => {
            const history = [
                { id: 'h1', request: { collectionId: 'col1' } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.getByCollection('col2');

            expect(result).toEqual([]);
        });

        test('should return empty array on error', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Error'));

            const result = await repository.getByCollection('col1');

            expect(result).toEqual([]);
        });
    });

    describe('search', () => {
        test('should search by URL', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://api.example.com/users', method: 'GET' }, response: {} },
                { id: 'h2', timestamp: 2000, request: { url: 'http://api.example.com/posts', method: 'GET' }, response: {} }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.search('users');

            expect(result).toHaveLength(1);
            expect(result[0].request.url).toContain('users');
        });

        test('should search by method', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://api.com', method: 'GET' }, response: {} },
                { id: 'h2', timestamp: 2000, request: { url: 'http://api.com', method: 'POST' }, response: {} }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.search('post');

            expect(result).toHaveLength(1);
            expect(result[0].request.method).toBe('POST');
        });

        test('should search by status code', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://api.com', method: 'GET' }, response: { status: 200 } },
                { id: 'h2', timestamp: 2000, request: { url: 'http://api.com', method: 'GET' }, response: { status: 404 } }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.search('404');

            expect(result).toHaveLength(1);
            expect(result[0].response.status).toBe(404);
        });

        test('should be case-insensitive', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://API.EXAMPLE.COM', method: 'GET' }, response: {} }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.search('api.example');

            expect(result).toHaveLength(1);
        });

        test('should return empty array on error', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Error'));

            const result = await repository.search('test');

            expect(result).toEqual([]);
        });

        test('should handle entries without response status', async () => {
            const history = [
                { id: 'h1', timestamp: 1000, request: { url: 'http://api.com', method: 'GET' }, response: null }
            ];
            mockBackendAPI.store.get.mockResolvedValue(history);

            const result = await repository.search('api');

            expect(result).toHaveLength(1);
        });
    });

    describe('_getArrayFromStore', () => {
        test('should return default value for non-array data', async () => {
            mockBackendAPI.store.get.mockResolvedValue('invalid');

            const result = await repository.getAll();

            expect(result).toEqual([]);
        });

        test('should initialize storage with default value', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ not: 'array' });

            await repository.getAll();

            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('requestHistory', []);
        });
    });
});
