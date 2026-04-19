import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

describe('CollectionRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            collections: {
                getAll: jest.fn(),
                get: jest.fn(),
                save: jest.fn(),
                delete: jest.fn(),
                list: jest.fn(),
                getEndpointData: jest.fn(),
                saveEndpointData: jest.fn(),
                deleteEndpointData: jest.fn(),
                getVariables: jest.fn(),
                saveVariables: jest.fn()
            },
            store: {
                get: jest.fn(),
                set: jest.fn()
            }
        };

        repository = new CollectionRepository(mockBackendAPI);
    });

    describe('getAllPersistedEndpointData', () => {
        test('should return all endpoint data in single call', async () => {
            const endpointData = {
                url: 'https://api.example.com/users',
                authConfig: { type: 'bearer', token: 'abc123' },
                pathParams: [{ key: 'id', value: '123' }],
                queryParams: [{ key: 'page', value: '1' }],
                headers: [{ key: 'X-Custom', value: 'value' }],
                modifiedBody: '{"name": "test"}',
                graphqlData: { query: 'query { users }', variables: '{}' },
                grpcData: { service: 'UserService', method: 'GetUser' }
            };
            mockBackendAPI.collections.getEndpointData.mockResolvedValue(endpointData);

            const result = await repository.getAllPersistedEndpointData('collection_1', 'endpoint_1');

            expect(result).toEqual({
                url: 'https://api.example.com/users',
                authConfig: { type: 'bearer', token: 'abc123' },
                pathParams: [{ key: 'id', value: '123' }],
                queryParams: [{ key: 'page', value: '1' }],
                headers: [{ key: 'X-Custom', value: 'value' }],
                modifiedBody: '{"name": "test"}',
                graphqlData: { query: 'query { users }', variables: '{}' },
                formBodyData: null,
                grpcData: { service: 'UserService', method: 'GetUser' },
                responseSchema: null
            });
            expect(mockBackendAPI.collections.getEndpointData).toHaveBeenCalledWith('collection_1', 'endpoint_1');
            expect(mockBackendAPI.collections.getEndpointData).toHaveBeenCalledTimes(1);
        });

        test('should return default values for missing fields', async () => {
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({});

            const result = await repository.getAllPersistedEndpointData('collection_1', 'endpoint_1');

            expect(result).toEqual({
                url: null,
                authConfig: null,
                pathParams: [],
                queryParams: [],
                headers: [],
                modifiedBody: null,
                graphqlData: null,
                formBodyData: null,
                grpcData: null,
                responseSchema: null
            });
        });

        test('should return default values for partial data', async () => {
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({
                url: 'https://api.example.com',
                headers: [{ key: 'Authorization', value: 'Bearer token' }]
            });

            const result = await repository.getAllPersistedEndpointData('collection_1', 'endpoint_1');

            expect(result).toEqual({
                url: 'https://api.example.com',
                authConfig: null,
                pathParams: [],
                queryParams: [],
                headers: [{ key: 'Authorization', value: 'Bearer token' }],
                modifiedBody: null,
                graphqlData: null,
                formBodyData: null,
                grpcData: null,
                responseSchema: null
            });
        });

        test('should return empty structure on backend error', async () => {
            mockBackendAPI.collections.getEndpointData.mockRejectedValue(new Error('Not found'));

            const result = await repository.getAllPersistedEndpointData('collection_1', 'endpoint_1');

            expect(result).toEqual({
                url: null,
                authConfig: null,
                pathParams: [],
                queryParams: [],
                headers: [],
                modifiedBody: null,
                graphqlData: null,
                formBodyData: null,
                grpcData: null,
                responseSchema: null
            });
        });
    });

    describe('getAll', () => {
        test('should return all collections', async () => {
            const collections = [
                { id: 'col_1', name: 'Collection 1' },
                { id: 'col_2', name: 'Collection 2' }
            ];
            mockBackendAPI.collections.getAll.mockResolvedValue(collections);

            const result = await repository.getAll();

            expect(result).toEqual(collections);
        });

        test('should return empty array when no collections', async () => {
            mockBackendAPI.collections.getAll.mockResolvedValue(null);

            const result = await repository.getAll();

            expect(result).toEqual([]);
        });

        test('should throw error on failure', async () => {
            mockBackendAPI.collections.getAll.mockRejectedValue(new Error('Storage error'));

            await expect(repository.getAll()).rejects.toThrow('Failed to load collections');
        });
    });

    describe('getById', () => {
        test('should return collection by ID', async () => {
            const collection = { id: 'col_1', name: 'Test Collection' };
            mockBackendAPI.collections.get.mockResolvedValue(collection);

            const result = await repository.getById('col_1');

            expect(result).toEqual(collection);
        });

        test('should cache collection after fetch', async () => {
            const collection = { id: 'col_1', name: 'Test Collection' };
            mockBackendAPI.collections.get.mockResolvedValue(collection);

            await repository.getById('col_1');
            await repository.getById('col_1');

            // Should only call backend once due to caching
            expect(mockBackendAPI.collections.get).toHaveBeenCalledTimes(1);
        });

        test('should return undefined for non-existent collection', async () => {
            mockBackendAPI.collections.get.mockRejectedValue(new Error('Not found'));

            const result = await repository.getById('non_existent');

            expect(result).toBeUndefined();
        });
    });

    describe('saveOne', () => {
        test('should save collection and update cache', async () => {
            const collection = { id: 'col_1', name: 'Test Collection' };
            mockBackendAPI.collections.save.mockResolvedValue();

            await repository.saveOne(collection);

            expect(mockBackendAPI.collections.save).toHaveBeenCalledWith(collection);

            // Verify cache is updated
            mockBackendAPI.collections.get.mockResolvedValue(collection);
            const cached = await repository.getById('col_1');
            expect(cached).toEqual(collection);
            // Should not call backend since it's cached
            expect(mockBackendAPI.collections.get).not.toHaveBeenCalled();
        });

        test('should throw error on save failure', async () => {
            mockBackendAPI.collections.save.mockRejectedValue(new Error('Write failed'));

            await expect(repository.saveOne({ id: 'col_1' })).rejects.toThrow('Failed to save collection');
        });
    });

    describe('delete', () => {
        test('should delete collection and clear from cache', async () => {
            const collection = { id: 'col_1', name: 'Test Collection' };
            mockBackendAPI.collections.get.mockResolvedValue(collection);
            mockBackendAPI.collections.delete.mockResolvedValue();

            // Populate cache
            await repository.getById('col_1');

            // Delete
            const result = await repository.delete('col_1');

            expect(result).toBe(true);
            expect(mockBackendAPI.collections.delete).toHaveBeenCalledWith('col_1');

            // Cache should be cleared, so next fetch should call backend
            await repository.getById('col_1');
            expect(mockBackendAPI.collections.get).toHaveBeenCalledTimes(2);
        });

        test('should throw error on delete failure', async () => {
            mockBackendAPI.collections.delete.mockRejectedValue(new Error('Delete failed'));

            await expect(repository.delete('col_1')).rejects.toThrow('Failed to delete collection');
        });
    });

    describe('individual endpoint data methods', () => {
        test('getPersistedUrl should return URL', async () => {
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({ url: 'https://api.example.com' });

            const result = await repository.getPersistedUrl('col_1', 'ep_1');

            expect(result).toBe('https://api.example.com');
        });

        test('getPersistedAuthConfig should return auth config', async () => {
            const authConfig = { type: 'bearer', token: 'abc' };
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({ authConfig });

            const result = await repository.getPersistedAuthConfig('col_1', 'ep_1');

            expect(result).toEqual(authConfig);
        });

        test('getPersistedPathParams should return path params', async () => {
            const pathParams = [{ key: 'id', value: '123' }];
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({ pathParams });

            const result = await repository.getPersistedPathParams('col_1', 'ep_1');

            expect(result).toEqual(pathParams);
        });

        test('getPersistedQueryParams should return query params', async () => {
            const queryParams = [{ key: 'page', value: '1' }];
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({ queryParams });

            const result = await repository.getPersistedQueryParams('col_1', 'ep_1');

            expect(result).toEqual(queryParams);
        });

        test('getPersistedHeaders should return headers', async () => {
            const headers = [{ key: 'X-Custom', value: 'value' }];
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({ headers });

            const result = await repository.getPersistedHeaders('col_1', 'ep_1');

            expect(result).toEqual(headers);
        });

        test('getModifiedRequestBody should return body', async () => {
            mockBackendAPI.collections.getEndpointData.mockResolvedValue({ modifiedBody: '{"test": true}' });

            const result = await repository.getModifiedRequestBody('col_1', 'ep_1');

            expect(result).toBe('{"test": true}');
        });
    });

    describe('expansion states', () => {
        test('should get collection expansion states', async () => {
            const states = { col_1: { expanded: true, folders: {} } };
            mockBackendAPI.store.get.mockResolvedValue(states);

            const result = await repository.getCollectionExpansionStates();

            expect(result).toEqual(states);
        });

        test('should return empty object when no states saved', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getCollectionExpansionStates();

            expect(result).toEqual({});
        });

        test('should save collection expansion states', async () => {
            const states = { col_1: { expanded: true, folders: {} } };
            mockBackendAPI.store.set.mockResolvedValue();

            await repository.saveCollectionExpansionStates(states);

            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('collectionExpansionStates', states);
        });
    });
});
