/* global document, window */
/** @fileoverview Golden test: the editor send path and the collection runner must hand the bridge the same request config. */

import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';
import {
    COLLECTION,
    VARIABLES,
    SETTINGS,
    CERT,
    COOKIE_HEADER,
    GRAPHQL,
    SCENARIOS,
    clone,
    scenarioEndpoint,
    scenarioPersisted
} from './__fixtures__/parityScenario.js';

const KNOWN_DELTAS = Object.freeze(['requestId', 'rawUrl']);

function rowMarkup(key, value) {
    return `<div class="key-value-row">
        <input class="key-input" value="${key}">
        <input class="value-input" value="${value}">
    </div>`;
}

function makeBackendAPI() {
    return {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({ ...SETTINGS }) },
        history: { add: jest.fn().mockResolvedValue(undefined) },
        oauth2: { getToken: jest.fn() },
        scripts: { executePreRequest: jest.fn(), executeTest: jest.fn() },
        sendApiRequest: jest.fn().mockResolvedValue({ success: true, status: 200, statusText: 'OK', headers: {}, data: 'ok' })
    };
}

function scriptMutation(requestConfig) {
    return { ...requestConfig, queryParams: { ...requestConfig.queryParams, added: '1' } };
}

function installSharedMocks(scenario) {
    jest.resetModules();
    const persisted = scenarioPersisted(scenario);

    jest.doMock('../../src/modules/storage/CollectionRepository.js', () => ({
        CollectionRepository: class {
            async getById(id) {
                return id === COLLECTION.id ? clone(COLLECTION) : null;
            }
            async getAll() {
                return [clone(COLLECTION)];
            }
            async getAllPersistedEndpointData() {
                return clone(persisted);
            }
            async getInheritedAuth() {
                return { authConfig: { type: 'none', config: {} }, source: null };
            }
            async saveAuthConfigAtSource() {}
        }
    }));
    jest.doMock('../../src/modules/storage/VariableRepository.js', () => ({
        VariableRepository: class {
            async getVariablesForCollection() {
                return {};
            }
        }
    }));
    jest.doMock('../../src/modules/storage/EnvironmentRepository.js', () => ({
        EnvironmentRepository: class {
            async getActiveEnvironmentVariables() {
                return { ...VARIABLES };
            }
        }
    }));
    jest.doMock('../../src/modules/services/MockServerService.js', () => ({
        MockServerService: class {
            async shouldUseMockServer() {
                return scenario.mock
                    ? { shouldUseMock: true, mockBaseUrl: scenario.mock }
                    : { shouldUseMock: false, mockBaseUrl: null };
            }
        }
    }));
    jest.doMock('../../src/modules/services/CertificateService.js', () => ({
        CertificateService: class {
            async getItems() {
                return [];
            }
            getForHost(host) {
                return host === 'api.test' ? { ...CERT } : null;
            }
        }
    }));
    jest.doMock('../../src/modules/editorLoader.js', () => ({
        loadEditor: jest.fn(() => Promise.resolve(class {})),
        warmEditors: jest.fn(),
        createLazyEditorProxy: jest.fn(() => ({ setContent: jest.fn(), clear: jest.fn(), onLanguageChange: jest.fn(), setLanguage: jest.fn() }))
    }));
    return persisted;
}

function installApp(app, scenario) {
    app.secretStore = null;
    app.statusBar = { setRequestRunning: jest.fn() };
    app.cookieController = {
        getCookieHeader: jest.fn().mockResolvedValue(COOKIE_HEADER),
        handleCookiesFromResponse: jest.fn()
    };
    app.certificateController = { getForHost: (host) => (host === 'api.test' ? { ...CERT } : null) };
    if (scenario.script) {
        app.scriptController = {
            getScriptsForEndpoint: jest.fn().mockResolvedValue({ preRequestScript: 'add()', testScript: '' }),
            executePreRequest: jest.fn(async (collectionId, endpointId, requestConfig) => scriptMutation(requestConfig)),
            executeTest: jest.fn(),
            service: {
                executePreRequestScript: jest.fn(async (script, requestConfig) => ({
                    modifiedRequest: scriptMutation(requestConfig),
                    result: { success: true, logs: [], errors: [], testResults: [], variablesSet: {} }
                }))
            }
        };
    }
}

function clearApp(app) {
    for (const key of Object.keys(app)) {
        delete app[key];
    }
}

async function sendThroughEditor(scenario) {
    document.body.innerHTML = `${requestBarMarkup()}${requestFormMarkup()}<textarea id="body-input"></textarea>`;
    const persisted = installSharedMocks(scenario);

    const apiHandler = await import('../../src/modules/apiHandler.js');
    const { app } = await import('../../src/modules/appContext.js');
    const { AuthManager } = await import('../../src/modules/authManager.js');
    const authManager = new AuthManager({ typeSelect: null, fieldsContainer: null });
    app.authManager = authManager;
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setRequestMode } = await import('../../src/modules/requestModeManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');

    initTabListeners();
    window.backendAPI = makeBackendAPI();
    installApp(app, scenario);
    const { installTestRequestPipeline } = await import('../helpers/requestPipeline.js');
    await installTestRequestPipeline(app, window.backendAPI);
    app.workspaceTabController = {
        service: { getActiveTabId: jest.fn().mockResolvedValue('tab-1'), updateTab: jest.fn().mockResolvedValue(undefined) }
    };

    const endpoint = scenarioEndpoint(scenario);
    setCurrentEndpoint({ collectionId: COLLECTION.id, endpointId: endpoint.id });
    jest.spyOn(authManager, 'getAuthConfig').mockReturnValue(persisted.authConfig || { type: 'none', config: {} });

    if (scenario.graphql) {
        setRequestMode('graphql');
        apiHandler.setGraphQLBodyManager({
            isGraphQLMode: () => true,
            getGraphQLQuery: () => GRAPHQL.query,
            getGraphQLVariables: () => GRAPHQL.variables,
            getSelectedOperationName: () => GRAPHQL.operationName
        });
    } else {
        setRequestMode('http');
    }

    document.getElementById('url-input').value = `${COLLECTION.baseUrl}${endpoint.path}`;
    document.getElementById('method-select').value = endpoint.method;
    document.getElementById('path-params-list').innerHTML = persisted.pathParams.map((row) => rowMarkup(row.key, row.value)).join('');
    document.getElementById('query-params-list').innerHTML = persisted.queryParams.map((row) => rowMarkup(row.key, row.value)).join('');
    document.getElementById('headers-list').innerHTML = persisted.headers.map((row) => rowMarkup(row.key, row.value)).join('');
    document.getElementById('body-mode-select').value = 'json';
    document.getElementById('body-input').value = persisted.modifiedBody || '';

    await apiHandler.handleSendRequest();

    const sent = window.backendAPI.sendApiRequest.mock.calls[0]?.[0];
    apiHandler.setGraphQLBodyManager(null);
    clearApp(app);
    return sent;
}

async function sendThroughRunner(scenario) {
    document.body.innerHTML = '';
    installSharedMocks(scenario);

    const { RunnerService } = await import('../../src/modules/services/RunnerService.js');
    const { app } = await import('../../src/modules/appContext.js');
    const backendAPI = makeBackendAPI();
    window.backendAPI = backendAPI;
    installApp(app, scenario);
    const { installTestRequestPipeline } = await import('../helpers/requestPipeline.js');
    const pipeline = await installTestRequestPipeline(app, backendAPI);

    const service = new RunnerService({ getAll: jest.fn() }, backendAPI, { update: jest.fn() }, { pipeline });
    const endpoint = scenarioEndpoint(scenario);
    const result = await service._executeRequest({
        collectionId: COLLECTION.id,
        endpointId: endpoint.id,
        name: endpoint.name,
        method: endpoint.method,
        path: endpoint.path
    }, {}, 0);

    const sent = backendAPI.sendApiRequest.mock.calls[0]?.[0];
    clearApp(app);
    if (!sent) {
        throw new Error(`runner did not send: ${result.error}`);
    }
    return sent;
}

function normalize(config) {
    const copy = { ...config };
    for (const key of KNOWN_DELTAS) {
        delete copy[key];
    }
    for (const key of ['auth', 'awsAuth', 'ntlm', 'clientCert']) {
        if (copy[key] === null) {
            delete copy[key];
        }
    }
    return JSON.parse(JSON.stringify(copy));
}

afterEach(() => {
    document.body.innerHTML = '';
    delete window.backendAPI;
    jest.restoreAllMocks();
});

describe.each(SCENARIOS)('request config parity: %s', (name, scenario) => {
    test('the editor path and the runner path send the same config', async () => {
        const editor = await sendThroughEditor(scenario);
        const runner = await sendThroughRunner(scenario);

        expect(editor).toBeDefined();
        expect(editor).toMatchSnapshot({ requestId: expect.any(String) }, 'editor');
        expect(runner).toMatchSnapshot({ requestId: expect.any(String) }, 'runner');
        expect(normalize(editor)).toStrictEqual(normalize(runner));
    });
});
