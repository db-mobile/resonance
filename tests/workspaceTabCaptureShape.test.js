/* global document */
/** @fileoverview Pins the exact shape of what captureCurrentState writes. */

import { requestBarMarkup, requestFormMarkup } from './helpers/requestBarMarkup.js';

const SAVED_ENDPOINT = {
    collectionId: 'col-1',
    endpointId: 'ep-1',
    path: '/things/{id}',
    method: 'GET'
};

const AUTH_CONFIG = { type: 'bearer', config: { token: 'secret' } };

async function loadHarness() {
    document.body.innerHTML = requestBarMarkup() + requestFormMarkup();
    jest.resetModules();

    jest.doMock('../src/modules/apiHandler.js', () => ({
        displayResponseWithLineNumbersForTab: jest.fn(),
        clearResponseDisplayForTab: jest.fn(),
        clearSchemaValidationBadge: jest.fn(),
        clearGraphQLErrorsBadge: jest.fn()
    }));
    jest.doMock('../src/modules/authManager.js', () => ({
        authManager: {
            getAuthConfig: jest.fn(() => AUTH_CONFIG),
            loadAuthConfig: jest.fn()
        }
    }));

    const { WorkspaceTabStateManager } = await import('../src/modules/WorkspaceTabStateManager.js');
    const { setRequestMode, RequestMode } = await import('../src/modules/requestModeManager.js');
    const { initTabListeners } = await import('../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../src/modules/state/currentEndpoint.js');
    const { app } = await import('../src/modules/appContext.js');
    const domElements = await import('../src/modules/domElements.js');

    initTabListeners();

    const graphqlBodyManager = {
        getGraphQLQuery: () => 'query Q { me { id } }',
        getGraphQLVariables: () => '{"a":1}',
        getSelectedOperationName: () => 'Q',
        setGraphQLModeEnabled: jest.fn(),
        switchMode: jest.fn(),
        isGraphQLMode: () => false
    };
    app.captureGrpcState = jest.fn(() => ({ target: 'localhost:50051' }));
    app.graphqlBodyManager = graphqlBodyManager;

    const manager = new WorkspaceTabStateManager({ ...domElements, graphqlBodyManager });

    return { manager, setRequestMode, RequestMode, setCurrentEndpoint, app };
}

const EXPECTED_REQUEST_KEYS = {
    grpc: ['grpc', 'protocol'],
    sse: ['authConfig', 'authType', 'body', 'headers', 'method', 'pathParams', 'protocol', 'queryParams', 'url'],
    websocket: ['authConfig', 'authType', 'body', 'headers', 'method', 'pathParams', 'protocol', 'queryParams', 'url'],
    mqtt: ['authConfig', 'authType', 'body', 'broker', 'clientId', 'method', 'password', 'protocol', 'publishTopic', 'qos', 'subscribeTopic', 'username'],
    graphql: ['authConfig', 'authType', 'headers', 'method', 'operationName', 'protocol', 'query', 'url', 'variables'],
    http: ['authConfig', 'authType', 'body', 'headers', 'method', 'pathParams', 'protocol', 'queryParams', 'url']
};

const EXPECTED_ENDPOINT_KEYS = {
    grpc: ['collectionId', 'endpointId', 'protocol'],
    sse: ['collectionId', 'endpointId', 'protocol'],
    websocket: ['collectionId', 'endpointId', 'protocol'],
    mqtt: ['collectionId', 'endpointId', 'protocol'],
    graphql: ['collectionId', 'endpointId', 'protocol'],
    http: ['collectionId', 'endpointId', 'method', 'path']
};

const EXPECTED_TOP_KEYS = {
    grpc: ['endpoint', 'request'],
    sse: ['activeResponseTab', 'endpoint', 'request'],
    websocket: ['activeResponseTab', 'endpoint', 'request'],
    mqtt: ['activeResponseTab', 'endpoint', 'request'],
    graphql: ['activeResponseTab', 'endpoint', 'request'],
    http: ['activeResponseTab', 'endpoint', 'previewMode', 'request']
};

const PROTOCOLS = Object.keys(EXPECTED_REQUEST_KEYS);

describe('captureCurrentState shape per protocol', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    for (const protocol of PROTOCOLS) {
        describe(protocol, () => {
            test('captures exactly its request keys', async () => {
                const { manager, setRequestMode } = await loadHarness();
                setRequestMode(protocol);

                const state = await manager.captureCurrentState();

                expect(Object.keys(state.request).sort()).toEqual(EXPECTED_REQUEST_KEYS[protocol]);
                expect(state.request.protocol).toBe(protocol);
            });

            test('captures exactly its top-level keys', async () => {
                const { manager, setRequestMode } = await loadHarness();
                setRequestMode(protocol);

                const state = await manager.captureCurrentState();

                expect(Object.keys(state).sort()).toEqual(EXPECTED_TOP_KEYS[protocol]);
            });

            test('captures exactly its endpoint keys when an endpoint is loaded', async () => {
                const { manager, setRequestMode, setCurrentEndpoint } = await loadHarness();
                setCurrentEndpoint(SAVED_ENDPOINT);
                setRequestMode(protocol);

                const state = await manager.captureCurrentState();

                expect(Object.keys(state.endpoint).sort()).toEqual(EXPECTED_ENDPOINT_KEYS[protocol]);
                expect(state.endpoint.collectionId).toBe('col-1');
                expect(state.endpoint.endpointId).toBe('ep-1');
            });

            test('captures a null endpoint when none is loaded', async () => {
                const { manager, setRequestMode, setCurrentEndpoint } = await loadHarness();
                setCurrentEndpoint(null);
                setRequestMode(protocol);

                const state = await manager.captureCurrentState();

                expect(state.endpoint).toBeNull();
            });
        });
    }

    test('HTTP stores the endpoint path and method, not a protocol', async () => {
        const { manager, setRequestMode, setCurrentEndpoint } = await loadHarness();
        setCurrentEndpoint(SAVED_ENDPOINT);
        setRequestMode('http');

        const { endpoint } = await manager.captureCurrentState();

        expect(endpoint.path).toBe('/things/{id}');
        expect(endpoint.method).toBe('GET');
        expect(endpoint).not.toHaveProperty('protocol');
    });

    test('MQTT stores its target under broker and coerces a non-numeric QoS to 0', async () => {
        const { manager, setRequestMode } = await loadHarness();
        setRequestMode('mqtt');

        document.getElementById('mqtt-broker-input').value = 'mqtt://localhost:1883';
        document.getElementById('mqtt-topic-input').value = 'a/b';
        const qos = document.getElementById('mqtt-qos-select');
        qos.innerHTML = '<option value="">--</option>';
        qos.value = '';

        const { request } = await manager.captureCurrentState();

        expect(request.broker).toBe('mqtt://localhost:1883');
        expect(request).not.toHaveProperty('url');
        expect(request.publishTopic).toBe('a/b');
        expect(request.qos).toBe(0);
    });

    test('SSE captures the text body mode separately from json', async () => {
        const { manager, setRequestMode, app } = await loadHarness();
        app.requestBodyTextEditor = { getContent: () => 'raw text body' };
        setRequestMode('sse');

        document.getElementById('body-mode-select').value = 'text';
        const textState = await manager.captureCurrentState();
        expect(textState.request.body).toEqual({ mode: 'text', content: 'raw text body' });

        document.getElementById('body-mode-select').value = 'json';
        const jsonState = await manager.captureCurrentState();
        expect(jsonState.request.body.mode).toBe('json');
    });

    test('gRPC captures the protocol state and skips the response tab', async () => {
        const { manager, setRequestMode, app } = await loadHarness();
        setRequestMode('grpc');

        const state = await manager.captureCurrentState();

        expect(app.captureGrpcState).toHaveBeenCalled();
        expect(state.request.grpc).toEqual({ target: 'localhost:50051' });
        expect(state).not.toHaveProperty('activeResponseTab');
    });

    test('the active response tab defaults to the body tab', async () => {
        const { manager, setRequestMode } = await loadHarness();
        setRequestMode('http');

        const state = await manager.captureCurrentState();

        expect(state.activeResponseTab).toBe('response-body');
    });
});
