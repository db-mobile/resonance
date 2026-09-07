import { VariableRepository } from '../../src/modules/storage/VariableRepository.js';

describe('VariableRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            collections: {
                list: jest.fn(),
                getVariables: jest.fn(),
                saveVariables: jest.fn()
            },
            store: {
                set: jest.fn()
            }
        };

        repository = new VariableRepository(mockBackendAPI);
    });

    describe('getVariablesForCollection', () => {
        test('should return variables from backend', async () => {
            const variables = [
                { key: 'baseUrl', value: 'https://api.example.com' },
                { key: 'apiKey', value: 'secret123' }
            ];
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);

            const result = await repository.getVariablesForCollection('collection_1');

            expect(result).toEqual({
                baseUrl: 'https://api.example.com',
                apiKey: 'secret123'
            });
            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledWith('collection_1');
        });

        test('should return empty object on error', async () => {
            mockBackendAPI.collections.getVariables.mockRejectedValue(new Error('Not found'));

            const result = await repository.getVariablesForCollection('collection_1');

            expect(result).toEqual({});
        });

        test('should handle object format variables', async () => {
            const variables = { baseUrl: 'https://api.example.com' };
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);

            const result = await repository.getVariablesForCollection('collection_1');

            expect(result).toEqual({ baseUrl: 'https://api.example.com' });
        });
    });

    describe('caching', () => {
        test('should cache variables after first fetch', async () => {
            const variables = [{ key: 'baseUrl', value: 'https://api.example.com' }];
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);

            await repository.getVariablesForCollection('collection_1');
            await repository.getVariablesForCollection('collection_1');

            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledTimes(1);
        });

        test('should return cached value on subsequent calls', async () => {
            const variables = [{ key: 'baseUrl', value: 'https://api.example.com' }];
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);

            const result1 = await repository.getVariablesForCollection('collection_1');
            const result2 = await repository.getVariablesForCollection('collection_1');

            expect(result1).toEqual(result2);
            expect(result1).toEqual({ baseUrl: 'https://api.example.com' });
        });

        test('should cache different collections separately', async () => {
            mockBackendAPI.collections.getVariables
                .mockResolvedValueOnce([{ key: 'var1', value: 'value1' }])
                .mockResolvedValueOnce([{ key: 'var2', value: 'value2' }]);

            const result1 = await repository.getVariablesForCollection('collection_1');
            const result2 = await repository.getVariablesForCollection('collection_2');

            expect(result1).toEqual({ var1: 'value1' });
            expect(result2).toEqual({ var2: 'value2' });
            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledTimes(2);
        });

        test('should update cache when setVariablesForCollection is called', async () => {
            mockBackendAPI.collections.getVariables.mockResolvedValue([{ key: 'old', value: 'oldValue' }]);
            mockBackendAPI.collections.saveVariables.mockResolvedValue();

            await repository.getVariablesForCollection('collection_1');

            await repository.setVariablesForCollection('collection_1', { new: 'newValue' });

            const result = await repository.getVariablesForCollection('collection_1');

            expect(result).toEqual({ new: 'newValue' });
            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledTimes(1);
        });

        test('should invalidate cache for specific collection', async () => {
            const variables = [{ key: 'baseUrl', value: 'https://api.example.com' }];
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);

            await repository.getVariablesForCollection('collection_1');
            await repository.getVariablesForCollection('collection_2');

            repository.invalidateCache('collection_1');

            await repository.getVariablesForCollection('collection_1');
            await repository.getVariablesForCollection('collection_2');

            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledTimes(3);
        });

        test('should invalidate entire cache when called without collectionId', async () => {
            const variables = [{ key: 'baseUrl', value: 'https://api.example.com' }];
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);

            await repository.getVariablesForCollection('collection_1');
            await repository.getVariablesForCollection('collection_2');

            repository.invalidateCache();

            await repository.getVariablesForCollection('collection_1');
            await repository.getVariablesForCollection('collection_2');

            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledTimes(4);
        });

        test('should invalidate cache on write error', async () => {
            const variables = [{ key: 'baseUrl', value: 'https://api.example.com' }];
            mockBackendAPI.collections.getVariables.mockResolvedValue(variables);
            mockBackendAPI.collections.saveVariables.mockRejectedValue(new Error('Write failed'));

            await repository.getVariablesForCollection('collection_1');

            await expect(repository.setVariablesForCollection('collection_1', { new: 'value' }))
                .rejects.toThrow('Failed to save collection variables');

            await repository.getVariablesForCollection('collection_1');

            expect(mockBackendAPI.collections.getVariables).toHaveBeenCalledTimes(2);
        });
    });

    describe('setVariablesForCollection', () => {
        test('should save variables to backend', async () => {
            mockBackendAPI.collections.saveVariables.mockResolvedValue();

            await repository.setVariablesForCollection('collection_1', {
                baseUrl: 'https://api.example.com',
                apiKey: 'secret123'
            });

            expect(mockBackendAPI.collections.saveVariables).toHaveBeenCalledWith(
                'collection_1',
                expect.arrayContaining([
                    expect.objectContaining({ key: 'baseUrl', value: 'https://api.example.com' }),
                    expect.objectContaining({ key: 'apiKey', value: 'secret123' })
                ])
            );
        });

        test('should throw error on save failure', async () => {
            mockBackendAPI.collections.saveVariables.mockRejectedValue(new Error('Write failed'));

            await expect(repository.setVariablesForCollection('collection_1', { key: 'value' }))
                .rejects.toThrow('Failed to save collection variables');
        });
    });

    describe('setVariable', () => {
        test('should set single variable', async () => {
            mockBackendAPI.collections.getVariables.mockResolvedValue([]);
            mockBackendAPI.collections.saveVariables.mockResolvedValue();

            await repository.setVariable('collection_1', 'newVar', 'newValue');

            expect(mockBackendAPI.collections.saveVariables).toHaveBeenCalledWith(
                'collection_1',
                [{ key: 'newVar', value: 'newValue' }]
            );
        });

        test('should merge with existing variables', async () => {
            mockBackendAPI.collections.getVariables.mockResolvedValue([
                { key: 'existing', value: 'existingValue' }
            ]);
            mockBackendAPI.collections.saveVariables.mockResolvedValue();

            await repository.setVariable('collection_1', 'newVar', 'newValue');

            expect(mockBackendAPI.collections.saveVariables).toHaveBeenCalledWith(
                'collection_1',
                expect.arrayContaining([
                    expect.objectContaining({ key: 'existing', value: 'existingValue' }),
                    expect.objectContaining({ key: 'newVar', value: 'newValue' })
                ])
            );
        });
    });

    describe('deleteVariable', () => {
        test('should delete variable from collection', async () => {
            mockBackendAPI.collections.getVariables.mockResolvedValue([
                { key: 'keep', value: 'keepValue' },
                { key: 'delete', value: 'deleteValue' }
            ]);
            mockBackendAPI.collections.saveVariables.mockResolvedValue();

            await repository.deleteVariable('collection_1', 'delete');

            expect(mockBackendAPI.collections.saveVariables).toHaveBeenCalledWith(
                'collection_1',
                [{ key: 'keep', value: 'keepValue' }]
            );
        });
    });

    describe('getVariable', () => {
        test('should return single variable value', async () => {
            mockBackendAPI.collections.getVariables.mockResolvedValue([
                { key: 'baseUrl', value: 'https://api.example.com' }
            ]);

            const result = await repository.getVariable('collection_1', 'baseUrl');

            expect(result).toBe('https://api.example.com');
        });

        test('should return undefined for non-existent variable', async () => {
            mockBackendAPI.collections.getVariables.mockResolvedValue([]);

            const result = await repository.getVariable('collection_1', 'nonExistent');

            expect(result).toBeUndefined();
        });
    });
});
