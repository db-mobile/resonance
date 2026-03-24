import { EnvironmentRepository } from '../../src/modules/storage/EnvironmentRepository.js';

describe('EnvironmentRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn().mockResolvedValue()
            }
        };

        repository = new EnvironmentRepository(mockBackendAPI);
    });

    describe('getAllEnvironments', () => {
        test('should return environments from storage', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'Development', variables: { baseUrl: 'http://localhost' }, color: '#FF0000' }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getAllEnvironments();

            expect(result.items).toHaveLength(1);
            expect(result.items[0].name).toBe('Development');
            expect(result.activeEnvironmentId).toBe('env_1');
        });

        test('should initialize with default environment when storage is empty', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getAllEnvironments();

            expect(result.items).toHaveLength(1);
            expect(result.items[0].name).toBe('Default');
            expect(result.activeEnvironmentId).toBe(result.items[0].id);
            expect(mockBackendAPI.store.set).toHaveBeenCalled();
        });

        test('should initialize when items is not an array', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ items: 'invalid' });

            const result = await repository.getAllEnvironments();

            expect(result.items).toHaveLength(1);
            expect(result.items[0].name).toBe('Default');
        });

        test('should normalize environment data', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'Test', variables: null, color: 'invalid' }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getAllEnvironments();

            expect(result.items[0].variables).toEqual({});
            expect(result.items[0].color).toBeNull();
        });

        test('should throw error on storage failure', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Storage error'));

            await expect(repository.getAllEnvironments()).rejects.toThrow('Failed to load environments');
        });
    });

    describe('caching', () => {
        test('should cache environments after first fetch', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await repository.getAllEnvironments();
            await repository.getAllEnvironments();

            expect(mockBackendAPI.store.get).toHaveBeenCalledTimes(1);
        });

        test('should return cached value on subsequent calls', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result1 = await repository.getAllEnvironments();
            const result2 = await repository.getAllEnvironments();

            expect(result1).toBe(result2);
        });
    });

    describe('getActiveEnvironmentId', () => {
        test('should return active environment ID', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getActiveEnvironmentId();

            expect(result).toBe('env_1');
        });

        test('should fallback to first environment if no active set', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: null
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getActiveEnvironmentId();

            expect(result).toBe('env_1');
        });

        test('should return null on error', async () => {
            mockBackendAPI.store.get.mockRejectedValue(new Error('Error'));

            const result = await repository.getActiveEnvironmentId();

            expect(result).toBeNull();
        });
    });

    describe('setActiveEnvironment', () => {
        test('should set active environment', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'Dev', variables: {}, color: null },
                    { id: 'env_2', name: 'Prod', variables: {}, color: null }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.setActiveEnvironment('env_2');

            expect(result).toBe(true);
        });

        test('should throw error for non-existent environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.setActiveEnvironment('non_existent'))
                .rejects.toThrow('Environment with ID non_existent not found');
        });
    });

    describe('getEnvironmentById', () => {
        test('should return environment by ID', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'Dev', variables: {}, color: null },
                    { id: 'env_2', name: 'Prod', variables: {}, color: null }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getEnvironmentById('env_2');

            expect(result.name).toBe('Prod');
        });

        test('should return undefined for non-existent environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getEnvironmentById('non_existent');

            expect(result).toBeUndefined();
        });
    });

    describe('getActiveEnvironment', () => {
        test('should return active environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: { key: 'value' }, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getActiveEnvironment();

            expect(result.name).toBe('Test');
            expect(result.variables).toEqual({ key: 'value' });
        });

        test('should return null when no active environment', async () => {
            const envData = {
                items: [],
                activeEnvironmentId: null
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getActiveEnvironment();

            expect(result).toBeNull();
        });
    });

    describe('createEnvironment', () => {
        test('should create new environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Existing', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.createEnvironment('New Env', { baseUrl: 'http://test.com' }, '#00FF00');

            expect(result.name).toBe('New Env');
            expect(result.variables).toEqual({ baseUrl: 'http://test.com' });
            expect(result.color).toBe('#00FF00');
            expect(result.id).toMatch(/^env_/);
        });

        test('should throw error for duplicate name', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Existing', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.createEnvironment('Existing'))
                .rejects.toThrow('Environment with name "Existing" already exists');
        });
    });

    describe('updateEnvironment', () => {
        test('should update environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Old Name', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.updateEnvironment('env_1', { name: 'New Name' });

            expect(result.name).toBe('New Name');
            expect(result.id).toBe('env_1');
        });

        test('should throw error for non-existent environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.updateEnvironment('non_existent', { name: 'New' }))
                .rejects.toThrow('Environment with ID non_existent not found');
        });

        test('should throw error for duplicate name', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'First', variables: {}, color: null },
                    { id: 'env_2', name: 'Second', variables: {}, color: null }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.updateEnvironment('env_1', { name: 'Second' }))
                .rejects.toThrow('Environment with name "Second" already exists');
        });
    });

    describe('deleteEnvironment', () => {
        test('should delete environment', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'First', variables: {}, color: null },
                    { id: 'env_2', name: 'Second', variables: {}, color: null }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.deleteEnvironment('env_2');

            expect(result).toBe(true);
        });

        test('should throw error when deleting last environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Only', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.deleteEnvironment('env_1'))
                .rejects.toThrow('Cannot delete the last environment');
        });

        test('should set new active environment when deleting active', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'First', variables: {}, color: null },
                    { id: 'env_2', name: 'Second', variables: {}, color: null }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await repository.deleteEnvironment('env_1');

            // Verify store.set was called with env_2 as active
            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1].activeEnvironmentId).toBe('env_2');
        });

        test('should throw error for non-existent environment', async () => {
            const envData = {
                items: [
                    { id: 'env_1', name: 'First', variables: {}, color: null },
                    { id: 'env_2', name: 'Second', variables: {}, color: null }
                ],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.deleteEnvironment('non_existent'))
                .rejects.toThrow('Environment with ID non_existent not found');
        });
    });

    describe('duplicateEnvironment', () => {
        test('should duplicate environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Original', variables: { key: 'value' }, color: '#FF0000' }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.duplicateEnvironment('env_1');

            expect(result.name).toBe('Original (Copy)');
            expect(result.variables).toEqual({ key: 'value' });
            expect(result.id).not.toBe('env_1');
        });

        test('should duplicate with custom name', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Original', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.duplicateEnvironment('env_1', 'Custom Name');

            expect(result.name).toBe('Custom Name');
        });

        test('should throw error for non-existent environment', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            await expect(repository.duplicateEnvironment('non_existent'))
                .rejects.toThrow('Environment with ID non_existent not found');
        });
    });

    describe('getActiveEnvironmentVariables', () => {
        test('should return active environment variables', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: { baseUrl: 'http://api.com' }, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getActiveEnvironmentVariables();

            expect(result).toEqual({ baseUrl: 'http://api.com' });
        });

        test('should return empty object when no active environment', async () => {
            const envData = {
                items: [],
                activeEnvironmentId: null
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getActiveEnvironmentVariables();

            expect(result).toEqual({});
        });
    });

    describe('exportEnvironments', () => {
        test('should export all environments', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.exportEnvironments();

            expect(result.items).toHaveLength(1);
        });
    });

    describe('importEnvironments', () => {
        test('should import environments (replace mode)', async () => {
            const existingData = {
                items: [{ id: 'env_1', name: 'Existing', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(existingData);

            const importData = {
                items: [
                    { id: 'old_id', name: 'Imported', variables: { key: 'value' }, color: null }
                ]
            };

            const result = await repository.importEnvironments(importData, false);

            expect(result).toBe(true);
            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1].items).toHaveLength(1);
            expect(setCall[1].items[0].name).toBe('Imported');
            expect(setCall[1].items[0].id).not.toBe('old_id'); // New ID generated
        });

        test('should import environments (merge mode)', async () => {
            const existingData = {
                items: [{ id: 'env_1', name: 'Existing', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(existingData);

            const importData = {
                items: [
                    { id: 'old_id', name: 'New Env', variables: {}, color: null }
                ]
            };

            const result = await repository.importEnvironments(importData, true);

            expect(result).toBe(true);
            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1].items).toHaveLength(2);
        });

        test('should skip duplicate names in merge mode', async () => {
            const existingData = {
                items: [{ id: 'env_1', name: 'Existing', variables: {}, color: null }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(existingData);

            const importData = {
                items: [
                    { id: 'old_id', name: 'Existing', variables: { new: 'var' }, color: null }
                ]
            };

            await repository.importEnvironments(importData, true);

            const setCall = mockBackendAPI.store.set.mock.calls[0];
            expect(setCall[1].items).toHaveLength(1); // Not added due to duplicate name
        });

        test('should throw error for invalid data format', async () => {
            await expect(repository.importEnvironments({ invalid: 'data' }))
                .rejects.toThrow('Invalid environments data format');
        });
    });

    describe('_normalizeColor', () => {
        test('should normalize valid hex color', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: '#ff0000' }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getAllEnvironments();

            expect(result.items[0].color).toBe('#FF0000');
        });

        test('should return null for invalid color', async () => {
            const envData = {
                items: [{ id: 'env_1', name: 'Test', variables: {}, color: 'red' }],
                activeEnvironmentId: 'env_1'
            };
            mockBackendAPI.store.get.mockResolvedValue(envData);

            const result = await repository.getAllEnvironments();

            expect(result.items[0].color).toBeNull();
        });
    });
});
