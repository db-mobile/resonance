import { CollectionEndpointLoaderService } from '../../src/modules/services/CollectionEndpointLoaderService.js';
import { app } from '../../src/modules/appContext.js';

/**
 * The read side of the protocol registry.
 *
 * Loading used to re-derive the protocol from the same three-branch chain as
 * saving, so even a correctly stored SSE endpoint came back as http.
 */
describe('CollectionEndpointLoaderService protocol handling', () => {
    let repository;
    let loader;
    let loadEndpoint;

    const storedData = {
        url: 'https://api.example.com/v1/stream',
        authConfig: { type: 'bearer', config: { token: 'abc' } },
        pathParams: [{ key: 'id', value: '1' }],
        queryParams: [{ key: 'model', value: 'sonnet' }],
        headers: [{ key: 'Accept', value: 'text/event-stream' }],
        modifiedBody: '{"prompt":"hi"}',
        graphqlData: { query: 'query { users }' },
        formBodyData: { mode: 'formdata', fields: {} },
        grpcData: { target: 'localhost:50051' },
        mqttData: { clientId: 'resonance-1', qos: 1 },
        responseSchema: null
    };

    const collection = { id: 'c1', baseUrl: 'https://api.example.com', defaultHeaders: {} };

    beforeEach(() => {
        repository = {
            getAllPersistedEndpointData: jest.fn().mockResolvedValue(storedData)
        };
        loader = new CollectionEndpointLoaderService({
            repository,
            collectionService: { generateRequestBody: jest.fn(() => '') },
            schemaProcessor: { setOpenApiSpec: jest.fn() },
            getFormElements: jest.fn(),
            setActiveEndpoint: jest.fn()
        });
        loadEndpoint = jest.fn().mockResolvedValue(undefined);
        app.workspaceTabController = { loadEndpoint };
    });

    async function loadedData(endpoint) {
        await loader.loadEndpointIntoWorkspaceTab(collection, endpoint);
        return loadEndpoint.mock.calls[0][0];
    }

    test('a stored SSE endpoint loads back as SSE', async () => {
        const data = await loadedData({
            id: 'e1',
            name: 'Token stream',
            protocol: 'sse',
            method: 'SSE',
            httpMethod: 'POST',
            path: 'https://api.example.com/v1/stream'
        });

        expect(data.protocol).toBe('sse');
    });

    test('an SSE endpoint reports the HTTP verb it was saved with', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'sse',
            method: 'SSE',
            httpMethod: 'POST',
            path: 'https://api.example.com/v1/stream'
        });

        expect(data.method).toBe('POST');
    });

    test('an SSE endpoint keeps its url, auth, query params, headers and body', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'sse',
            method: 'SSE',
            httpMethod: 'GET',
            path: 'https://api.example.com/v1/stream'
        });

        expect(data.persistedUrl).toBe('https://api.example.com/v1/stream');
        expect(data.persistedAuthConfig).toEqual({ type: 'bearer', config: { token: 'abc' } });
        expect(data.persistedQueryParams).toEqual([{ key: 'model', value: 'sonnet' }]);
        expect(data.persistedHeaders).toEqual([{ key: 'Accept', value: 'text/event-stream' }]);
        expect(data.persistedBody).toBe('{"prompt":"hi"}');
    });

    test('an SSE endpoint is not given data it has no UI for', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'sse',
            method: 'SSE',
            path: 'https://api.example.com/v1/stream'
        });

        expect(data.persistedPathParams).toEqual([]);
        expect(data.persistedFormBodyData).toBeNull();
        expect(data.persistedGraphQLData).toBeNull();
        expect(data.grpcData).toBeNull();
    });

    test('an MQTT endpoint receives its broker settings', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'mqtt',
            method: 'MQTT',
            path: 'mqtt://broker.example.com:1883'
        });

        expect(data.protocol).toBe('mqtt');
        expect(data.persistedMqttData).toEqual({ clientId: 'resonance-1', qos: 1 });
    });

    test('a grpc endpoint still sees only its own data', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'grpc',
            method: 'GRPC',
            path: '/pkg.UserService/GetUser'
        });

        expect(data.protocol).toBe('grpc');
        expect(data.grpcData).toEqual({ target: 'localhost:50051' });
        expect(data.persistedUrl).toBeNull();
        expect(data.persistedHeaders).toEqual([]);
    });

    test('an http endpoint still sees the full HTTP data set', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'http',
            method: 'GET',
            path: '/api/users'
        });

        expect(data.protocol).toBe('http');
        expect(data.persistedPathParams).toEqual([{ key: 'id', value: '1' }]);
        expect(data.persistedFormBodyData).toEqual({ mode: 'formdata', fields: {} });
        expect(data.grpcData).toBeNull();
    });

    test('a websocket endpoint still has auth suppressed', async () => {
        const data = await loadedData({
            id: 'e1',
            protocol: 'websocket',
            method: 'WS',
            path: 'wss://echo.websocket.events'
        });

        expect(data.protocol).toBe('websocket');
        expect(data.persistedAuthConfig).toBeNull();
        expect(data.persistedQueryParams).toEqual([{ key: 'model', value: 'sonnet' }]);
    });
});
