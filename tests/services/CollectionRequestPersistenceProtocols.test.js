/* global document */
import { CollectionRequestPersistenceService } from '../../src/modules/services/CollectionRequestPersistenceService.js';

/**
 * Re-saving an existing endpoint.
 *
 * The HTTP saver rewrites `endpoint.path` to the entered URL's pathname, which
 * is right for a collection-relative HTTP request and destructive for every
 * protocol whose endpoint *is* an absolute URL. It also read the shared
 * `#url-input` rather than the protocol's own field.
 */
describe('CollectionRequestPersistenceService protocol routing', () => {
    let repository;
    let service;
    let collection;

    beforeEach(() => {
        collection = {
            id: 'c1',
            endpoints: [
                {
                    id: 'sse1',
                    protocol: 'sse',
                    method: 'SSE',
                    httpMethod: 'GET',
                    path: 'https://api.example.com/v1/stream'
                },
                {
                    id: 'http1',
                    protocol: 'http',
                    method: 'GET',
                    path: '/api/users'
                }
            ],
            folders: []
        };

        repository = {
            readForUpdate: jest.fn().mockResolvedValue(collection),
            saveOne: jest.fn().mockResolvedValue(undefined),
            updateEndpointFields: jest.fn().mockResolvedValue(undefined),
            savePersistedUrl: jest.fn().mockResolvedValue(undefined),
            savePersistedQueryParams: jest.fn().mockResolvedValue(undefined),
            savePersistedHeaders: jest.fn().mockResolvedValue(undefined),
            savePersistedAuthConfig: jest.fn().mockResolvedValue(undefined),
            saveMqttData: jest.fn().mockResolvedValue(undefined)
        };

        service = new CollectionRequestPersistenceService({
            repository,
            collectionService: { saveRequestBodyModification: jest.fn() },
            statusDisplay: { update: jest.fn() },
            refreshCollections: jest.fn()
        });

        document.body.innerHTML = `
            <input id="url-input" value="https://mirrored.example.com/v1/stream" />
            <input id="sse-url-input" value="https://api.example.com/v2/stream" />
            <select id="method-select"><option value="POST" selected>POST</option></select>
            <div id="query-params-list"></div>
            <div id="headers-list"></div>
        `;
    });

    test('an SSE endpoint is saved by the SSE path, reading its own url field', async () => {
        await service.saveAllRequestModifications('c1', 'sse1');

        expect(repository.savePersistedUrl).toHaveBeenCalledWith(
            'c1',
            'sse1',
            'https://api.example.com/v2/stream'
        );
    });

    test('an SSE endpoint keeps its absolute path instead of being truncated', async () => {
        await service.saveAllRequestModifications('c1', 'sse1');

        const sseEndpoint = collection.endpoints.find(endpoint => endpoint.id === 'sse1');
        expect(sseEndpoint.path).toBe('https://api.example.com/v1/stream');
    });

    test('an SSE endpoint persists its authentication, unlike a websocket one', async () => {
        collection.endpoints.push({
            id: 'ws1',
            protocol: 'websocket',
            method: 'WS',
            path: 'wss://echo.websocket.events'
        });

        await service.saveAllRequestModifications('c1', 'sse1');
        expect(repository.savePersistedAuthConfig).toHaveBeenCalledWith(
            'c1',
            'sse1',
            expect.any(Object)
        );

        repository.savePersistedAuthConfig.mockClear();

        await service.saveAllRequestModifications('c1', 'ws1');
        expect(repository.savePersistedAuthConfig).not.toHaveBeenCalled();
    });

    const savedEndpoint = (endpointId) => {
        const saved = repository.saveOne.mock.calls.at(-1)[0];
        return saved.endpoints.find(endpoint => endpoint.id === endpointId);
    };

    test('an SSE endpoint records a changed HTTP verb', async () => {
        await service.saveAllRequestModifications('c1', 'sse1');

        expect(savedEndpoint('sse1').httpMethod).toBe('POST');
    });

    test('an http endpoint still has its path rewritten from the url', async () => {
        await service.saveAllRequestModifications('c1', 'http1');

        expect(savedEndpoint('http1').path).toBe('/v1/stream');
    });

    describe('patchEndpointRecords', () => {
        test('updates every stored copy of an endpoint', async () => {
            collection.folders = [
                { id: 'f1', name: 'sse', endpoints: [collection.endpoints[0]] }
            ];

            await service.patchEndpointRecords('c1', 'sse1', { httpMethod: 'PUT' });

            const saved = repository.saveOne.mock.calls.at(-1)[0];
            expect(saved.endpoints.find(endpoint => endpoint.id === 'sse1').httpMethod).toBe('PUT');
            expect(saved.folders[0].endpoints.find(endpoint => endpoint.id === 'sse1').httpMethod).toBe('PUT');
        });

        test('does not mutate the collection it was handed', async () => {
            await service.patchEndpointRecords('c1', 'sse1', { httpMethod: 'PUT' });

            expect(collection.endpoints[0].httpMethod).toBe('GET');
        });

        test('does not write when nothing changed', async () => {
            await service.patchEndpointRecords('c1', 'sse1', { httpMethod: 'GET' });

            expect(repository.saveOne).not.toHaveBeenCalled();
        });
    });

    describe('saveMqttRequest', () => {
        beforeEach(() => {
            collection.endpoints.push({
                id: 'mqtt1',
                protocol: 'mqtt',
                method: 'MQTT',
                path: 'mqtt://broker.example.com:1883'
            });

            document.body.innerHTML += `
                <input id="mqtt-broker-input" value="mqtt://broker.example.com:8883" />
                <input id="mqtt-client-id-input" value="resonance-1" />
                <input id="mqtt-username-input" value="sensor" />
                <input id="mqtt-password-input" value="hunter2" />
                <input id="mqtt-subscribe-input" value="sensors/#" />
                <input id="mqtt-topic-input" value="sensors/cmd" />
                <select id="mqtt-qos-select"><option value="1" selected>1</option></select>
            `;
        });

        test('stores the broker settings from the MQTT fields', async () => {
            await service.saveAllRequestModifications('c1', 'mqtt1');

            expect(repository.savePersistedUrl).toHaveBeenCalledWith(
                'c1',
                'mqtt1',
                'mqtt://broker.example.com:8883'
            );
            expect(repository.saveMqttData).toHaveBeenCalledWith('c1', 'mqtt1', {
                clientId: 'resonance-1',
                username: 'sensor',
                subscribeTopic: 'sensors/#',
                publishTopic: 'sensors/cmd',
                qos: 1
            });
        });

        test('never writes the broker password to stored data', async () => {
            await service.saveAllRequestModifications('c1', 'mqtt1');

            const stored = JSON.stringify(repository.saveMqttData.mock.calls[0][2]);
            expect(stored).not.toContain('hunter2');
        });

        test('keeps the broker address as the endpoint path', async () => {
            await service.saveAllRequestModifications('c1', 'mqtt1');

            const mqttEndpoint = collection.endpoints.find(endpoint => endpoint.id === 'mqtt1');
            expect(mqttEndpoint.path).toBe('mqtt://broker.example.com:1883');
        });
    });
});
