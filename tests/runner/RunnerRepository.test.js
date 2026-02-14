import { RunnerRepository } from '../../src/modules/storage/RunnerRepository.js';

describe('RunnerRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn()
            }
        };

        repository = new RunnerRepository(mockBackendAPI);
    });

    describe('getAll', () => {
        test('should return empty array when no runners exist', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getAll();

            expect(result).toEqual([]);
            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('collectionRunners', []);
        });

        test('should return runners array from storage', async () => {
            const runners = [
                { id: 'runner_1', name: 'Test Runner 1' },
                { id: 'runner_2', name: 'Test Runner 2' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(runners);

            const result = await repository.getAll();

            expect(result).toEqual(runners);
        });

        test('should return empty array on storage error', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Storage error'));

            const result = await repository.getAll();

            expect(result).toEqual([]);
        });

        test('should initialize storage when data is not an array', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ invalid: 'data' });

            const result = await repository.getAll();

            expect(result).toEqual([]);
            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('collectionRunners', []);
        });
    });

    describe('save', () => {
        test('should save runners to storage', async () => {
            const runners = [{ id: 'runner_1', name: 'Test Runner' }];
            mockBackendAPI.store.set.mockResolvedValue();

            await repository.save(runners);

            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('collectionRunners', runners);
        });

        test('should throw error on storage failure', async () => {
            mockBackendAPI.store.set.mockRejectedValue(new Error('Write failed'));

            await expect(repository.save([])).rejects.toThrow('Failed to save runners: Write failed');
        });
    });

    describe('getById', () => {
        test('should return runner by ID', async () => {
            const runners = [
                { id: 'runner_1', name: 'Test Runner 1' },
                { id: 'runner_2', name: 'Test Runner 2' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(runners);

            const result = await repository.getById('runner_2');

            expect(result).toEqual({ id: 'runner_2', name: 'Test Runner 2' });
        });

        test('should return undefined for non-existent runner', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.getById('non_existent');

            expect(result).toBeUndefined();
        });
    });

    describe('add', () => {
        test('should add new runner with generated ID and timestamps', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);
            mockBackendAPI.store.set.mockResolvedValue();

            const runnerData = {
                name: 'My Runner',
                collectionId: 'collection_1',
                requests: [{ endpointId: 'endpoint_1' }]
            };

            const result = await repository.add(runnerData);

            expect(result.id).toMatch(/^runner_\d+_[a-z0-9]+$/);
            expect(result.name).toBe('My Runner');
            expect(result.collectionId).toBe('collection_1');
            expect(result.requests).toEqual([{ endpointId: 'endpoint_1' }]);
            expect(result.options.stopOnError).toBe(true);
            expect(result.options.delayMs).toBe(0);
            expect(result.createdAt).toBeDefined();
            expect(result.lastModifiedAt).toBeDefined();
            expect(result.lastRunAt).toBeNull();
        });

        test('should use default values for missing properties', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.add({});

            expect(result.name).toBe('Untitled Runner');
            expect(result.collectionId).toBeNull();
            expect(result.requests).toEqual([]);
        });

        test('should merge custom options with defaults', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.add({
                name: 'Test',
                options: { delayMs: 500 }
            });

            expect(result.options.stopOnError).toBe(true);
            expect(result.options.delayMs).toBe(500);
        });
    });

    describe('update', () => {
        test('should update existing runner', async () => {
            const existingRunner = {
                id: 'runner_1',
                name: 'Old Name',
                requests: [],
                lastModifiedAt: 1000
            };
            mockBackendAPI.store.get.mockResolvedValue([existingRunner]);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.update('runner_1', { name: 'New Name' });

            expect(result.name).toBe('New Name');
            expect(result.lastModifiedAt).toBeGreaterThan(1000);
        });

        test('should return null for non-existent runner', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.update('non_existent', { name: 'New Name' });

            expect(result).toBeNull();
        });

        test('should preserve existing properties not being updated', async () => {
            const existingRunner = {
                id: 'runner_1',
                name: 'Test',
                collectionId: 'collection_1',
                requests: [{ id: 'req_1' }]
            };
            mockBackendAPI.store.get.mockResolvedValue([existingRunner]);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.update('runner_1', { name: 'Updated' });

            expect(result.collectionId).toBe('collection_1');
            expect(result.requests).toEqual([{ id: 'req_1' }]);
        });
    });

    describe('delete', () => {
        test('should delete runner by ID', async () => {
            const runners = [
                { id: 'runner_1', name: 'Runner 1' },
                { id: 'runner_2', name: 'Runner 2' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(runners);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.delete('runner_1');

            expect(result).toBe(true);
            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('collectionRunners', [
                { id: 'runner_2', name: 'Runner 2' }
            ]);
        });

        test('should return false for non-existent runner', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.delete('non_existent');

            expect(result).toBe(false);
        });
    });

    describe('getByCollectionId', () => {
        test('should return runners for specific collection', async () => {
            const runners = [
                { id: 'runner_1', collectionId: 'collection_1' },
                { id: 'runner_2', collectionId: 'collection_2' },
                { id: 'runner_3', collectionId: 'collection_1' }
            ];
            mockBackendAPI.store.get.mockResolvedValue(runners);

            const result = await repository.getByCollectionId('collection_1');

            expect(result).toHaveLength(2);
            expect(result.map(r => r.id)).toEqual(['runner_1', 'runner_3']);
        });

        test('should return empty array when no runners match', async () => {
            mockBackendAPI.store.get.mockResolvedValue([
                { id: 'runner_1', collectionId: 'collection_1' }
            ]);

            const result = await repository.getByCollectionId('collection_2');

            expect(result).toEqual([]);
        });
    });

    describe('updateLastRun', () => {
        test('should update lastRunAt timestamp', async () => {
            const existingRunner = {
                id: 'runner_1',
                name: 'Test',
                lastRunAt: null
            };
            mockBackendAPI.store.get.mockResolvedValue([existingRunner]);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.updateLastRun('runner_1');

            expect(result.lastRunAt).toBeDefined();
            expect(typeof result.lastRunAt).toBe('number');
        });
    });

    describe('duplicate', () => {
        test('should duplicate runner with new ID and name', async () => {
            const existingRunner = {
                id: 'runner_1',
                name: 'Original Runner',
                collectionId: 'collection_1',
                requests: [{ endpointId: 'endpoint_1' }],
                options: { stopOnError: false, delayMs: 100 }
            };
            mockBackendAPI.store.get.mockResolvedValue([existingRunner]);
            mockBackendAPI.store.set.mockResolvedValue();

            const result = await repository.duplicate('runner_1');

            expect(result.id).not.toBe('runner_1');
            expect(result.name).toBe('Original Runner (Copy)');
            expect(result.collectionId).toBe('collection_1');
            expect(result.requests).toEqual([{ endpointId: 'endpoint_1' }]);
            expect(result.lastRunAt).toBeNull();
        });

        test('should return null for non-existent runner', async () => {
            mockBackendAPI.store.get.mockResolvedValue([]);

            const result = await repository.duplicate('non_existent');

            expect(result).toBeNull();
        });
    });
});
