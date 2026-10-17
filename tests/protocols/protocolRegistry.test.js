import {
    PROTOCOLS,
    RequestMode,
    getProtocol,
    resolveProtocolId,
    listProtocolIds,
    derivePath,
    deriveMethod,
    deriveHttpMethod,
    endpointHttpMethod,
    projectPersistedData,
    registerProtocolHandler,
    getProtocolHandler
} from '../../src/modules/protocols/protocolRegistry.js';

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

const EXPECTED_URL_SECTIONS = {
    http: null,
    grpc: { sectionId: 'grpc-url-section' },
    sse: {
        sectionId: 'sse-url-section', method: 'SSE', label: 'SSE', inputType: 'url',
        placeholder: 'https://example.com/events', ariaLabel: 'SSE URL', peerId: 'url-input', syncQueryParams: true
    },
    websocket: {
        sectionId: 'websocket-url-section', method: 'WS', label: 'WS', inputType: 'url',
        placeholder: 'wss://echo.websocket.events', ariaLabel: 'WebSocket URL', peerId: 'url-input', syncQueryParams: true
    },
    mqtt: {
        sectionId: 'mqtt-url-section', method: 'MQTT', label: 'MQTT', inputType: 'text',
        placeholder: 'mqtt://localhost:1883', ariaLabel: 'MQTT Broker URL', peerId: 'url-input'
    },
    graphql: {
        sectionId: 'graphql-url-section', method: 'GRAPHQL', label: 'GraphQL', inputType: 'url',
        placeholder: 'https://api.example.com/graphql', ariaLabel: 'GraphQL Endpoint URL', peerId: 'url-input', syncQueryParams: true
    }
};

describe('protocol ui descriptors', () => {
    test('every descriptor carries the mode-manager ui block', () => {
        listProtocolIds().forEach((id) => {
            const { ui } = getProtocol(id);
            expect(Object.keys(ui).sort()).toEqual(expect.arrayContaining(
                ['urlSection', 'showBodyModeSelector', 'forceBodyMode', 'lockBodyMode', 'workbench'].sort()
            ));
            expect(ui.urlSection).toEqual(EXPECTED_URL_SECTIONS[id]);
        });
    });

    test('body-mode and workbench rules match the former MODE_UI table', () => {
        expect(getProtocol('http').ui).toMatchObject({ showBodyModeSelector: true, forceBodyMode: null, lockBodyMode: false, workbench: null });
        expect(getProtocol('websocket').ui).toMatchObject({ showBodyModeSelector: false, forceBodyMode: 'json', lockBodyMode: true, workbench: 'off' });
        expect(getProtocol('mqtt').ui).toMatchObject({ showBodyModeSelector: false, forceBodyMode: 'json', lockBodyMode: true, workbench: 'off' });
        expect(getProtocol('graphql').ui).toMatchObject({ showBodyModeSelector: false, forceBodyMode: null, lockBodyMode: null, workbench: 'on', alwaysActivateDefaultTab: true });
        expect(getProtocol('sse').ui.alwaysActivateDefaultTab).toBeUndefined();
    });

    test('liveControl names which button mirrors a live stream', () => {
        expect(Object.fromEntries(listProtocolIds().map((id) => [id, getProtocol(id).liveControl]))).toEqual({
            http: null, sse: 'cancel', websocket: 'cancel', graphql: 'send', grpc: 'cancel', mqtt: null
        });
    });
});

describe('protocol handlers', () => {
    const handler = { send: jest.fn(), cancel: jest.fn(), isLive: jest.fn(() => true) };

    test('round-trips a registered handler and freezes it', () => {
        registerProtocolHandler('sse', handler);

        const stored = getProtocolHandler('sse');
        expect(stored.send).toBe(handler.send);
        expect(Object.isFrozen(stored)).toBe(true);
    });

    test('unknown ids are rejected and unregistered protocols yield null', () => {
        expect(() => registerProtocolHandler('carrier-pigeon', handler)).toThrow('Unknown protocol: carrier-pigeon');
        expect(getProtocolHandler('mqtt')).toBeNull();
    });

    test('an unknown lookup resolves to the http handler', () => {
        registerProtocolHandler('http', handler);
        expect(getProtocolHandler('carrier-pigeon')).toBe(getProtocolHandler('http'));
    });
});
