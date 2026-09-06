/* global document */
/** @fileoverview Pins the per-protocol differences in restoreTabState that a */

import { requestBarMarkup, requestFormMarkup } from './helpers/requestBarMarkup.js';

const MIRROR_INPUTS = `
    <input id="sse-url-input">
    <input id="websocket-url-input">
    <input id="graphql-url-input">
    <input id="mqtt-broker-input">
`;

const ENDPOINT = { collectionId: 'col-1', endpointId: 'ep-1', path: '/x', method: 'GET' };

const keyValueCalls = {
    clear: jest.fn(),
    populate: jest.fn(),
    addRow: jest.fn(),
    updateUrl: jest.fn()
};

const modeCalls = [];

async function loadHarness() {
    document.body.innerHTML = requestBarMarkup() + requestFormMarkup() + MIRROR_INPUTS;
    jest.resetModules();
    modeCalls.length = 0;
    Object.values(keyValueCalls).forEach(fn => fn.mockClear());

    jest.doMock('../src/modules/apiHandler.js', () => ({
        displayResponseWithLineNumbersForTab: jest.fn(),
        clearResponseDisplayForTab: jest.fn(),
        clearSchemaValidationBadge: jest.fn(),
        clearGraphQLErrorsBadge: jest.fn()
    }));
    jest.doMock('../src/modules/authManager.js', () => ({
        authManager: { getAuthConfig: jest.fn(() => ({})), loadAuthConfig: jest.fn() }
    }));
    jest.doMock('../src/modules/mqttHandler.js', () => ({ refreshMqttConnectionUi: jest.fn() }));

    jest.doMock('../src/modules/requestModeManager.js', () => {
        const RequestMode = {
            HTTP: 'http', WEBSOCKET: 'websocket', GRPC: 'grpc',
            SSE: 'sse', MQTT: 'mqtt', GRAPHQL: 'graphql'
        };
        return {
            RequestMode,
            setRequestMode: jest.fn((mode) => {
                modeCalls.push({
                    mode,
                    urlAtCall: document.getElementById('url-input')?.value ?? ''
                });
            }),
            isGrpcMode: () => false,
            isWebSocketMode: () => false,
            isSseMode: () => false,
            isMqttMode: () => false,
            isGraphQLMode: () => false,
            getCurrentMode: () => 'http'
        };
    });

    jest.doMock('../src/modules/keyValueManager.js', () => ({
        parseKeyValuePairs: jest.fn(() => ({})),
        parseKeyValueRows: jest.fn(() => []),
        populateKeyValueList: jest.fn((...args) => keyValueCalls.populate(...args)),
        clearKeyValueList: jest.fn((...args) => keyValueCalls.clear(...args)),
        addKeyValueRow: jest.fn((...args) => keyValueCalls.addRow(...args)),
        updateUrlFromQueryParams: jest.fn((...args) => keyValueCalls.updateUrl(...args))
    }));

    const { WorkspaceTabStateManager } = await import('../src/modules/WorkspaceTabStateManager.js');
    const { initTabListeners } = await import('../src/modules/tabManager.js');
    const { getCurrentEndpoint } = await import('../src/modules/state/currentEndpoint.js');
    const { app } = await import('../src/modules/appContext.js');
    const domElements = await import('../src/modules/domElements.js');

    initTabListeners();

    const graphqlBodyManager = {
        setGraphQLModeEnabled: jest.fn(),
        switchMode: jest.fn(),
        isGraphQLMode: () => false,
        setGraphQLQuery: jest.fn(),
        setGraphQLVariables: jest.fn(),
        updateOperationPicker: jest.fn(),
        autoApplySchemaForUrl: jest.fn()
    };
    app.applyGrpcState = jest.fn();
    app.inlineScriptManager = { loadScripts: jest.fn(), clear: jest.fn() };
    app.schemaController = { loadSchema: jest.fn(), clearContext: jest.fn() };

    const manager = new WorkspaceTabStateManager({ ...domElements, graphqlBodyManager });
    manager._restoreResponse = jest.fn();
    manager._clearResponse = jest.fn();

    return { manager, graphqlBodyManager, app, getCurrentEndpoint };
}

function tabFor(protocol, overrides = {}) {
    const base = {
        grpc: { protocol: 'grpc', grpc: {} },
        sse: { protocol: 'sse', url: 'https://example.com/events', method: 'GET', body: { mode: 'json', content: '' } },
        websocket: { protocol: 'websocket', url: 'wss://example.com', body: { mode: 'json', content: '' } },
        graphql: { protocol: 'graphql', url: 'https://example.com/graphql', query: '', variables: '' },
        mqtt: { protocol: 'mqtt', broker: 'mqtt://localhost:1883', clientId: 'c1', username: 'u', password: 'p', subscribeTopic: 's/t', publishTopic: 'p/t', qos: 2, body: { mode: 'json', content: '' } },
        http: { protocol: 'http', url: 'https://example.com/api', method: 'POST', body: { mode: 'json', content: '' } }
    }[protocol];

    return { id: 'tab-1', request: { ...base, ...overrides }, endpoint: ENDPOINT };
}

const PROTOCOLS = ['grpc', 'sse', 'websocket', 'graphql', 'mqtt', 'http'];

describe('restoreTabState applies the mode for every protocol', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test.each(PROTOCOLS)('%s applies its own mode exactly once', async (protocol) => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor(protocol));

        expect(modeCalls.map(c => c.mode)).toEqual([protocol]);
    });

    test('GraphQL writes the URL before applying the mode', async () => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor('graphql'));

        expect(modeCalls[0].urlAtCall).toBe('https://example.com/graphql');
    });

    test.each(['sse', 'websocket', 'mqtt', 'http'])(
        '%s writes the URL after applying the mode',
        async (protocol) => {
            const { manager } = await loadHarness();

            await manager.restoreTabState(tabFor(protocol));

            expect(modeCalls[0].urlAtCall).toBe('');
            expect(document.getElementById('url-input').value).not.toBe('');
        }
    );
});

describe('empty key-value tables get different fallback rows', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('HTTP seeds an empty header table with a JSON content type', async () => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor('http'));

        const headersList = document.getElementById('headers-list');
        expect(keyValueCalls.addRow).toHaveBeenCalledWith(headersList, 'Content-Type', 'application/json');
    });

    test.each(['sse', 'websocket'])('%s seeds an empty header table with a bare row', async (protocol) => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor(protocol));

        const headersList = document.getElementById('headers-list');
        expect(keyValueCalls.addRow).toHaveBeenCalledWith(headersList);
        expect(keyValueCalls.addRow).not.toHaveBeenCalledWith(
            headersList, 'Content-Type', 'application/json'
        );
    });

    test('GraphQL clears the param tables without adding a row', async () => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor('graphql'));

        const pathParamsList = document.getElementById('path-params-list');
        const queryParamsList = document.getElementById('query-params-list');
        expect(keyValueCalls.clear).toHaveBeenCalledWith(pathParamsList);
        expect(keyValueCalls.clear).toHaveBeenCalledWith(queryParamsList);
        expect(keyValueCalls.addRow).not.toHaveBeenCalledWith(pathParamsList);
        expect(keyValueCalls.addRow).not.toHaveBeenCalledWith(queryParamsList);
    });
});

describe('response restoration is not uniform', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('gRPC restores no response and clears none', async () => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor('grpc'));

        expect(manager._restoreResponse).not.toHaveBeenCalled();
        expect(manager._clearResponse).not.toHaveBeenCalled();
    });

    test.each(['sse', 'websocket', 'graphql', 'mqtt', 'http'])(
        '%s clears the response when the tab has none',
        async (protocol) => {
            const { manager } = await loadHarness();

            await manager.restoreTabState(tabFor(protocol));

            expect(manager._clearResponse).toHaveBeenCalledWith('tab-1');
        }
    );

    test.each(['sse', 'websocket', 'graphql', 'mqtt', 'http'])(
        '%s restores a stored response',
        async (protocol) => {
            const { manager } = await loadHarness();
            const tab = { ...tabFor(protocol), response: { body: 'ok' } };

            await manager.restoreTabState(tab);

            expect(manager._restoreResponse).toHaveBeenCalledWith({ body: 'ok' }, 'tab-1');
        }
    );
});

describe('MQTT fans its broker record out across the connection fields', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('reads broker rather than url and fills every field', async () => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor('mqtt'));

        expect(document.getElementById('mqtt-broker-input').value).toBe('mqtt://localhost:1883');
        expect(document.getElementById('url-input').value).toBe('mqtt://localhost:1883');
        expect(document.getElementById('mqtt-client-id-input').value).toBe('c1');
        expect(document.getElementById('mqtt-username-input').value).toBe('u');
        expect(document.getElementById('mqtt-password-input').value).toBe('p');
        expect(document.getElementById('mqtt-subscribe-input').value).toBe('s/t');
        expect(document.getElementById('mqtt-topic-input').value).toBe('p/t');
        expect(document.getElementById('mqtt-qos-select').value).toBe('2');
    });
});

describe('HTTP alone drives the endpoint-scoped controllers', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('loads scripts and schema for the restored endpoint', async () => {
        const { manager, app } = await loadHarness();

        await manager.restoreTabState(tabFor('http'));

        expect(app.inlineScriptManager.loadScripts).toHaveBeenCalledWith('col-1', 'ep-1');
        expect(app.schemaController.loadSchema).toHaveBeenCalledWith('col-1', 'ep-1');
    });

    test('clears them when the tab record has an explicitly empty endpoint', async () => {
        const { manager, app } = await loadHarness();
        const tab = { ...tabFor('http'), endpoint: null };

        await manager.restoreTabState(tab);

        expect(app.inlineScriptManager.clear).toHaveBeenCalled();
        expect(app.schemaController.clearContext).toHaveBeenCalled();
    });

    test.each(['sse', 'websocket', 'graphql', 'mqtt', 'grpc'])(
        '%s does not touch the script or schema controllers',
        async (protocol) => {
            const { manager, app } = await loadHarness();

            await manager.restoreTabState(tabFor(protocol));

            expect(app.inlineScriptManager.loadScripts).not.toHaveBeenCalled();
            expect(app.schemaController.loadSchema).not.toHaveBeenCalled();
        }
    );
});

describe('a tab without a request record', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('is seeded with an HTTP default in place', async () => {
        const { manager } = await loadHarness();
        const tab = { id: 'tab-1' };

        await manager.restoreTabState(tab);

        expect(tab.request).toEqual({
            protocol: 'http',
            url: '',
            method: 'GET',
            pathParams: {},
            queryParams: {},
            headers: { 'Content-Type': 'application/json' },
            body: '',
            authType: 'none',
            authConfig: {}
        });
        expect(modeCalls.map(c => c.mode)).toEqual(['http']);
    });

    test('an unknown protocol falls through to the HTTP path', async () => {
        const { manager } = await loadHarness();

        await manager.restoreTabState(tabFor('http', { protocol: 'carrier-pigeon' }));

        expect(modeCalls.map(c => c.mode)).toEqual(['http']);
    });

    test('a null tab is ignored', async () => {
        const { manager } = await loadHarness();

        await expect(manager.restoreTabState(null)).resolves.toBeUndefined();
        expect(modeCalls).toHaveLength(0);
    });
});
