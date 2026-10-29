import { writeNewEndpointSidecars } from '../../src/modules/collections/endpointSidecars.js';
import { getProtocol } from '../../src/modules/protocols/protocolRegistry.js';

function makeRepository() {
    return {
        savePersistedUrl: jest.fn().mockResolvedValue(undefined),
        saveGrpcData: jest.fn().mockResolvedValue(undefined),
        saveGraphQLData: jest.fn().mockResolvedValue(undefined),
        saveMqttData: jest.fn().mockResolvedValue(undefined),
        saveWebSocketData: jest.fn().mockResolvedValue(undefined),
        savePersistedPathParams: jest.fn().mockResolvedValue(undefined),
        savePersistedQueryParams: jest.fn().mockResolvedValue(undefined),
        savePersistedHeaders: jest.fn().mockResolvedValue(undefined),
        saveModifiedRequestBody: jest.fn().mockResolvedValue(undefined),
        savePersistedAuthConfig: jest.fn().mockResolvedValue(undefined)
    };
}

const calledMethods = (repository) => Object.entries(repository).filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name).sort();

describe('writeNewEndpointSidecars', () => {
    test('an http request without extras writes nothing', async () => {
        const repository = makeRepository();

        await writeNewEndpointSidecars(repository, 'c1', 'e1', getProtocol('http'), { name: 'R', method: 'GET', path: '/r' });

        expect(calledMethods(repository)).toEqual([]);
    });

    test('an http request with a url writes it exactly once', async () => {
        const repository = makeRepository();

        await writeNewEndpointSidecars(repository, 'c1', 'e1', getProtocol('http'), { path: '/r', url: 'https://x/r' });

        expect(repository.savePersistedUrl).toHaveBeenCalledTimes(1);
        expect(repository.savePersistedUrl).toHaveBeenCalledWith('c1', 'e1', 'https://x/r');
    });

    test('url-based protocols always write a url, falling back to broker or path', async () => {
        const repository = makeRepository();

        await writeNewEndpointSidecars(repository, 'c1', 'e1', getProtocol('websocket'), { path: 'wss://x' });
        await writeNewEndpointSidecars(repository, 'c1', 'e2', getProtocol('mqtt'), { broker: 'mqtt://b' });

        expect(repository.savePersistedUrl).toHaveBeenNthCalledWith(1, 'c1', 'e1', 'wss://x');
        expect(repository.savePersistedUrl).toHaveBeenNthCalledWith(2, 'c1', 'e2', 'mqtt://b');
        expect(repository.saveMqttData).toHaveBeenCalledWith('c1', 'e2', expect.objectContaining({ username: '' }));
        expect(repository.saveMqttData.mock.calls[0][2]).not.toHaveProperty('password');
        expect(repository.saveWebSocketData).toHaveBeenCalledWith('c1', 'e1', { protocols: [], messages: [] });
    });

    test('a websocket request writes its normalised sub-protocols and saved messages', async () => {
        const repository = makeRepository();

        await writeNewEndpointSidecars(repository, 'c1', 'e1', getProtocol('websocket'), {
            url: 'wss://x', protocols: ' chat, superchat ', messages: [{ id: 'm1', name: 'Ping', mode: 'text', content: 'ping' }]
        });

        expect(repository.saveWebSocketData).toHaveBeenCalledWith('c1', 'e1', {
            protocols: ['chat', 'superchat'], messages: [{ id: 'm1', name: 'Ping', mode: 'text', content: 'ping' }]
        });
        expect(repository.saveMqttData).not.toHaveBeenCalled();
    });

    test('grpc and graphql write their protocol records with defaults', async () => {
        const repository = makeRepository();

        await writeNewEndpointSidecars(repository, 'c1', 'e1', getProtocol('grpc'), { fullMethod: 'pkg.Svc/Do' });
        await writeNewEndpointSidecars(repository, 'c1', 'e2', getProtocol('graphql'), { url: 'https://g', query: '{ a }' });

        expect(repository.saveGrpcData).toHaveBeenCalledWith('c1', 'e1', { target: '', service: '', fullMethod: 'pkg.Svc/Do', requestJson: '{}' });
        expect(repository.saveGraphQLData).toHaveBeenCalledWith('c1', 'e2', { query: '{ a }', variables: '', operationName: null });
        expect(repository.savePersistedUrl).toHaveBeenCalledTimes(1);
    });

    test('rows, body and auth are written only when present, and never for auth "none"', async () => {
        const repository = makeRepository();

        await writeNewEndpointSidecars(repository, 'c1', 'e1', getProtocol('http'), {
            pathParams: { id: '7' },
            queryParams: [{ key: 'q', value: '1' }],
            headers: { Accept: 'application/json' },
            body: '{"a":1}',
            authConfig: { type: 'bearer', config: { token: 't' } }
        });
        await writeNewEndpointSidecars(repository, 'c1', 'e2', getProtocol('http'), {
            pathParams: {}, queryParams: [], headers: [], body: undefined, authConfig: { type: 'none', config: {} }
        });

        expect(repository.savePersistedPathParams).toHaveBeenCalledTimes(1);
        expect(repository.savePersistedPathParams).toHaveBeenCalledWith('c1', 'e1', [{ key: 'id', value: '7' }]);
        expect(repository.savePersistedQueryParams).toHaveBeenCalledWith('c1', 'e1', [{ key: 'q', value: '1', enabled: true }]);
        expect(repository.savePersistedHeaders).toHaveBeenCalledWith('c1', 'e1', [{ key: 'Accept', value: 'application/json', enabled: true }]);
        expect(repository.saveModifiedRequestBody).toHaveBeenCalledWith('c1', 'e1', '{"a":1}');
        expect(repository.savePersistedAuthConfig).toHaveBeenCalledTimes(1);
        expect(repository.savePersistedAuthConfig).toHaveBeenCalledWith('c1', 'e1', { type: 'bearer', config: { token: 't' } });
    });
});
