import { WorkspaceTabEndpointLoaderService } from '../../src/modules/services/WorkspaceTabEndpointLoaderService.js';

/**
 * Keys WorkspaceTabStateManager captures for an SSE request.
 *
 * A tab update that does not produce exactly these keys restores as a blank or
 * mis-moded tab, so the shape is pinned rather than merely spot-checked.
 */
const SSE_REQUEST_KEYS = [
    'protocol',
    'url',
    'method',
    'pathParams',
    'queryParams',
    'headers',
    'body',
    'authType',
    'authConfig'
];

describe('WorkspaceTabEndpointLoaderService protocol dispatch', () => {
    let loader;

    beforeEach(() => {
        loader = new WorkspaceTabEndpointLoaderService({
            service: { generateTabName: jest.fn(() => 'Tab') },
            stateManager: {},
            responseContainerManager: {},
            tabBar: {},
            updateUIForTabType: jest.fn(),
            restoreTabStateSafely: jest.fn()
        });
    });

    describe('SSE', () => {
        const sseEndpoint = {
            id: 'e1',
            name: 'Token stream',
            collectionId: 'c1',
            protocol: 'sse',
            method: 'POST',
            path: 'https://api.example.com/v1/stream',
            persistedUrl: 'https://api.example.com/v1/stream',
            persistedQueryParams: [{ key: 'model', value: 'sonnet' }],
            persistedHeaders: [{ key: 'Accept', value: 'text/event-stream' }],
            persistedBody: '{"prompt":"hi"}',
            persistedAuthConfig: { type: 'bearer', config: { token: 'abc' } }
        };

        test('an SSE endpoint builds an SSE tab, not an HTTP one', () => {
            const update = loader.createTabUpdate(sseEndpoint);

            expect(update.request.protocol).toBe('sse');
            expect(update.endpoint.protocol).toBe('sse');
        });

        test('the request shape matches what the state manager captures', () => {
            const update = loader.createTabUpdate(sseEndpoint);

            expect(Object.keys(update.request).sort()).toEqual([...SSE_REQUEST_KEYS].sort());
        });

        test('the chosen verb and the absolute url survive', () => {
            const update = loader.createTabUpdate(sseEndpoint);

            expect(update.request.method).toBe('POST');
            expect(update.request.url).toBe('https://api.example.com/v1/stream');
        });

        test('authentication is read back rather than forced to none', () => {
            const update = loader.createTabUpdate(sseEndpoint);

            expect(update.request.authType).toBe('bearer');
            expect(update.request.authConfig).toEqual({ token: 'abc' });
        });

        test('a text content type restores the body in text mode', () => {
            const update = loader.createTabUpdate({
                ...sseEndpoint,
                persistedHeaders: [{ key: 'Content-Type', value: 'text/plain' }]
            });

            expect(update.request.body).toEqual({ mode: 'text', content: '{"prompt":"hi"}' });
        });

        test('a missing verb defaults to GET', () => {
            const update = loader.createTabUpdate({ ...sseEndpoint, method: undefined });

            expect(update.request.method).toBe('GET');
        });
    });

    describe('MQTT', () => {
        const mqttEndpoint = {
            id: 'e2',
            name: 'Sensor feed',
            collectionId: 'c1',
            protocol: 'mqtt',
            method: 'MQTT',
            path: 'mqtt://broker.example.com:1883',
            persistedUrl: 'mqtt://broker.example.com:1883',
            persistedBody: '{"cmd":"on"}',
            persistedMqttData: {
                clientId: 'resonance-1',
                username: 'sensor',
                subscribeTopic: 'sensors/#',
                publishTopic: 'sensors/cmd',
                qos: 1
            }
        };

        test('an MQTT endpoint builds an MQTT tab with its broker and topics', () => {
            const update = loader.createTabUpdate(mqttEndpoint);

            expect(update.request.protocol).toBe('mqtt');
            expect(update.request.broker).toBe('mqtt://broker.example.com:1883');
            expect(update.request.subscribeTopic).toBe('sensors/#');
            expect(update.request.publishTopic).toBe('sensors/cmd');
            expect(update.request.qos).toBe(1);
        });

        test('the broker password is not restored from storage', () => {
            const update = loader.createTabUpdate(mqttEndpoint);

            expect(update.request.password).toBe('');
        });
    });

    describe('fallback', () => {
        test('an unknown protocol still builds a usable HTTP tab', () => {
            const update = loader.createTabUpdate({
                id: 'e3',
                collectionId: 'c1',
                protocol: 'carrier-pigeon',
                method: 'GET',
                path: '/api/users'
            });

            expect(update.request.protocol).toBe('http');
        });

        test('existing protocols keep their builders', () => {
            const protocols = ['http', 'websocket', 'graphql', 'grpc'];

            protocols.forEach(protocol => {
                const update = loader.createTabUpdate({
                    id: 'e4',
                    collectionId: 'c1',
                    protocol,
                    method: 'GET',
                    path: '/api/users'
                });

                expect(update.request.protocol).toBe(protocol);
            });
        });
    });
});
