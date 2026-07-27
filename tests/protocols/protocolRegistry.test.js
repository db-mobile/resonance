import {
    PROTOCOLS,
    RequestMode,
    getProtocol,
    resolveProtocolId,
    protocolIdFromMethodLabel,
    listProtocolIds,
    derivePath,
    deriveMethod,
    deriveHttpMethod,
    endpointHttpMethod,
    projectPersistedData
} from '../../src/modules/protocols/protocolRegistry.js';

/**
 * The keys returned by CollectionRepository.getAllPersistedEndpointData(),
 * minus responseSchema, which is not projected per protocol.
 */
const PERSISTED_DATA_KINDS = [
    'url',
    'authConfig',
    'pathParams',
    'queryParams',
    'headers',
    'modifiedBody',
    'graphqlData',
    'formBodyData',
    'grpcData',
    'mqttData'
];

describe('protocolRegistry', () => {
    test('every request mode has a descriptor', () => {
        expect(listProtocolIds().sort()).toEqual(Object.values(RequestMode).sort());
    });

    test('unknown protocols resolve to http instead of degrading silently elsewhere', () => {
        expect(resolveProtocolId('carrier-pigeon')).toBe('http');
        expect(resolveProtocolId(undefined)).toBe('http');
        expect(resolveProtocolId(null)).toBe('http');
        expect(getProtocol('carrier-pigeon').id).toBe('http');
    });

    test('known protocols resolve to themselves', () => {
        Object.values(RequestMode).forEach(mode => {
            expect(resolveProtocolId(mode)).toBe(mode);
            expect(getProtocol(mode).id).toBe(mode);
        });
    });

    test('descriptor persisted maps cover exactly the repository data kinds', () => {
        Object.values(PROTOCOLS).forEach(descriptor => {
            expect(Object.keys(descriptor.persisted).sort()).toEqual([...PERSISTED_DATA_KINDS].sort());
        });
    });

    test('method labels reverse-map to their protocol', () => {
        expect(protocolIdFromMethodLabel('SSE')).toBe('sse');
        expect(protocolIdFromMethodLabel('WS')).toBe('websocket');
        expect(protocolIdFromMethodLabel('GQL')).toBe('graphql');
        expect(protocolIdFromMethodLabel('GRPC')).toBe('grpc');
        expect(protocolIdFromMethodLabel('MQTT')).toBe('mqtt');
        expect(protocolIdFromMethodLabel('GET')).toBeNull();
    });

    test('only http may rewrite a stored path from the entered URL', () => {
        const rewriting = Object.values(PROTOCOLS)
            .filter(descriptor => descriptor.rewritePathFromUrl)
            .map(descriptor => descriptor.id);

        expect(rewriting).toEqual(['http']);
    });

    test('only sse stores an HTTP verb alongside its badge', () => {
        const preserving = Object.values(PROTOCOLS)
            .filter(descriptor => descriptor.preservesHttpMethod)
            .map(descriptor => descriptor.id);

        expect(preserving).toEqual(['sse']);
    });

    test('http is not given a persisted url on creation', () => {
        expect(getProtocol('http').createSidecars).not.toContain('url');
        expect(getProtocol('sse').createSidecars).toContain('url');
    });

    describe('derivePath', () => {
        test('takes the absolute URL for url-addressed protocols', () => {
            const requestData = { url: 'https://api.example.com/events', path: '/events' };
            expect(derivePath(getProtocol('sse'), requestData)).toBe('https://api.example.com/events');
        });

        test('accepts a broker address in place of a URL', () => {
            const requestData = { broker: 'mqtt://broker.example.com:1883' };
            expect(derivePath(getProtocol('mqtt'), requestData)).toBe('mqtt://broker.example.com:1883');
        });

        test('takes the collection-relative path for http', () => {
            const requestData = { url: 'https://api.example.com/users', path: '/users' };
            expect(derivePath(getProtocol('http'), requestData)).toBe('/users');
        });

        test('takes the full method for grpc', () => {
            const requestData = { fullMethod: '/pkg.Service/Method' };
            expect(derivePath(getProtocol('grpc'), requestData)).toBe('/pkg.Service/Method');
        });
    });

    describe('method derivation', () => {
        test('sse stores the badge label and the chosen verb separately', () => {
            const descriptor = getProtocol('sse');
            const requestData = { method: 'POST' };

            expect(deriveMethod(descriptor, requestData)).toBe('SSE');
            expect(deriveHttpMethod(descriptor, requestData)).toBe('POST');
        });

        test('sse falls back to GET when no verb was captured', () => {
            expect(deriveHttpMethod(getProtocol('sse'), {})).toBe('GET');
        });

        test('http passes its own method through and stores no separate verb', () => {
            const descriptor = getProtocol('http');

            expect(deriveMethod(descriptor, { method: 'PATCH' })).toBe('PATCH');
            expect(deriveHttpMethod(descriptor, { method: 'PATCH' })).toBeNull();
        });

        test('reading back a verb prefers httpMethod only where it is stored', () => {
            expect(endpointHttpMethod({ protocol: 'sse', method: 'SSE', httpMethod: 'POST' })).toBe('POST');
            expect(endpointHttpMethod({ protocol: 'http', method: 'DELETE' })).toBe('DELETE');
            expect(endpointHttpMethod({ protocol: 'websocket', method: 'WS' })).toBe('WS');
        });
    });

    describe('projectPersistedData', () => {
        const storedData = {
            url: 'https://api.example.com/events',
            authConfig: { type: 'bearer', config: {} },
            pathParams: [{ key: 'id', value: '1' }],
            queryParams: [{ key: 'page', value: '1' }],
            headers: [{ key: 'Accept', value: 'text/event-stream' }],
            modifiedBody: '{}',
            graphqlData: { query: '' },
            formBodyData: { mode: 'formdata' },
            grpcData: { target: 'localhost' },
            mqttData: { qos: 1 }
        };

        test('sse keeps url, auth, query params, headers and body', () => {
            const projected = projectPersistedData(getProtocol('sse'), storedData);

            expect(projected.url).toBe('https://api.example.com/events');
            expect(projected.authConfig).toEqual({ type: 'bearer', config: {} });
            expect(projected.queryParams).toEqual([{ key: 'page', value: '1' }]);
            expect(projected.headers).toEqual([{ key: 'Accept', value: 'text/event-stream' }]);
            expect(projected.modifiedBody).toBe('{}');
        });

        test('suppressed kinds come back as type-correct empties', () => {
            const projected = projectPersistedData(getProtocol('sse'), storedData);

            expect(projected.pathParams).toEqual([]);
            expect(projected.formBodyData).toBeNull();
            expect(projected.graphqlData).toBeNull();
            expect(projected.grpcData).toBeNull();
            expect(projected.mqttData).toBeNull();
        });

        test('grpc sees only its own data', () => {
            const projected = projectPersistedData(getProtocol('grpc'), storedData);

            expect(projected.grpcData).toEqual({ target: 'localhost' });
            expect(projected.url).toBeNull();
            expect(projected.headers).toEqual([]);
        });

        test('missing stored data still yields the full shape', () => {
            const projected = projectPersistedData(getProtocol('http'), undefined);

            expect(projected.url).toBeNull();
            expect(projected.headers).toEqual([]);
        });
    });
});
