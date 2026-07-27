import { CollectionService } from '../../src/modules/services/CollectionService.js';

/**
 * Guards the protocol of a saved endpoint.
 *
 * SSE and MQTT endpoints used to be persisted as `http` because the save path
 * re-derived the protocol from a chain that only knew about gRPC, WebSocket and
 * GraphQL. These tests pin every protocol's stored shape so a protocol added
 * later cannot quietly degrade the same way.
 */
describe('CollectionService.addRequestToCollection protocol handling', () => {
    let repository;
    let service;
    let collection;

    beforeEach(() => {
        collection = { id: 'c1', name: 'Test', endpoints: [], folders: [] };
        repository = {
            getById: jest.fn().mockResolvedValue(collection),
            update: jest.fn().mockResolvedValue(undefined),
            savePersistedUrl: jest.fn().mockResolvedValue(undefined),
            saveGrpcData: jest.fn().mockResolvedValue(undefined),
            saveGraphQLData: jest.fn().mockResolvedValue(undefined),
            saveMqttData: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionService(repository, {}, { update: jest.fn() });
    });

    test('an SSE request is stored as SSE, not degraded to http', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Token stream',
            protocol: 'sse',
            method: 'POST',
            url: 'https://api.example.com/v1/stream',
            path: 'https://api.example.com/v1/stream'
        });

        expect(endpoint.protocol).toBe('sse');
        expect(endpoint.method).toBe('SSE');
        expect(endpoint.path).toBe('https://api.example.com/v1/stream');
    });

    test('an SSE request keeps the HTTP verb the user chose', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Token stream',
            protocol: 'sse',
            method: 'POST',
            url: 'https://api.example.com/v1/stream'
        });

        expect(endpoint.httpMethod).toBe('POST');
    });

    test('an SSE request gets its absolute URL persisted', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Token stream',
            protocol: 'sse',
            method: 'GET',
            url: 'https://api.example.com/v1/stream'
        });

        expect(repository.savePersistedUrl).toHaveBeenCalledWith(
            'c1',
            endpoint.id,
            'https://api.example.com/v1/stream'
        );
    });

    test('an MQTT request is stored as MQTT with its broker and settings', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Sensor feed',
            protocol: 'mqtt',
            broker: 'mqtt://broker.example.com:1883',
            clientId: 'resonance-1',
            subscribeTopic: 'sensors/#',
            publishTopic: 'sensors/cmd',
            qos: 1
        });

        expect(endpoint.protocol).toBe('mqtt');
        expect(endpoint.method).toBe('MQTT');
        expect(endpoint.path).toBe('mqtt://broker.example.com:1883');
        expect(repository.saveMqttData).toHaveBeenCalledWith('c1', endpoint.id, {
            clientId: 'resonance-1',
            username: '',
            subscribeTopic: 'sensors/#',
            publishTopic: 'sensors/cmd',
            qos: 1
        });
    });

    test('an http request keeps its relative path and its own verb', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'List users',
            protocol: 'http',
            method: 'PATCH',
            path: '/api/users'
        });

        expect(endpoint.protocol).toBe('http');
        expect(endpoint.method).toBe('PATCH');
        expect(endpoint.path).toBe('/api/users');
        expect(endpoint.httpMethod).toBeUndefined();
    });

    test('an http request is not given a persisted url, so {{baseUrl}} still applies', async () => {
        await service.addRequestToCollection('c1', {
            name: 'List users',
            protocol: 'http',
            method: 'GET',
            path: '/api/users'
        });

        expect(repository.savePersistedUrl).not.toHaveBeenCalled();
    });

    test('a websocket request keeps its previous stored shape', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Echo',
            protocol: 'websocket',
            url: 'wss://echo.websocket.events'
        });

        expect(endpoint.protocol).toBe('websocket');
        expect(endpoint.method).toBe('WS');
        expect(endpoint.path).toBe('wss://echo.websocket.events');
        expect(repository.savePersistedUrl).toHaveBeenCalledWith(
            'c1',
            endpoint.id,
            'wss://echo.websocket.events'
        );
    });

    test('a graphql request keeps its previous stored shape', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Users query',
            protocol: 'graphql',
            url: 'https://api.example.com/graphql',
            query: 'query { users { id } }',
            variables: '{}'
        });

        expect(endpoint.protocol).toBe('graphql');
        expect(endpoint.method).toBe('GQL');
        expect(repository.saveGraphQLData).toHaveBeenCalledWith('c1', endpoint.id, {
            query: 'query { users { id } }',
            variables: '{}',
            operationName: null
        });
    });

    test('a grpc request keeps its previous stored shape', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'GetUser',
            protocol: 'grpc',
            target: 'localhost:50051',
            service: 'UserService',
            fullMethod: '/pkg.UserService/GetUser',
            requestJson: '{}'
        });

        expect(endpoint.protocol).toBe('grpc');
        expect(endpoint.method).toBe('GRPC');
        expect(endpoint.path).toBe('/pkg.UserService/GetUser');
        expect(repository.saveGrpcData).toHaveBeenCalledWith('c1', endpoint.id, {
            target: 'localhost:50051',
            service: 'UserService',
            fullMethod: '/pkg.UserService/GetUser',
            requestJson: '{}'
        });
    });

    test('an unknown protocol falls back to http rather than throwing', async () => {
        const endpoint = await service.addRequestToCollection('c1', {
            name: 'Mystery',
            protocol: 'carrier-pigeon',
            method: 'GET',
            path: '/nowhere'
        });

        expect(endpoint.protocol).toBe('http');
    });

    describe('folder bucketing', () => {
        beforeEach(() => {
            collection.folders = [{ id: 'folder_api', name: 'api', endpoints: [] }];
        });

        test('an SSE endpoint is filed under its own bucket, not a URL-derived one', async () => {
            await service.addRequestToCollection('c1', {
                name: 'Token stream',
                protocol: 'sse',
                method: 'GET',
                url: 'https://api.example.com/v1/stream'
            });

            const folderNames = collection.folders.map(folder => folder.name);
            expect(folderNames).toContain('sse');
        });

        test('an http endpoint is still filed by its path', async () => {
            await service.addRequestToCollection('c1', {
                name: 'List users',
                protocol: 'http',
                method: 'GET',
                path: '/api/users'
            });

            const apiFolder = collection.folders.find(folder => folder.name === 'api');
            expect(apiFolder.endpoints).toHaveLength(1);
        });
    });
});
