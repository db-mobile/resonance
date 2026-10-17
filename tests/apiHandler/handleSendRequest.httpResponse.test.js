/* global document, window */
import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

async function loadApiHandler(sendResult) {
    document.body.innerHTML = requestBarMarkup() + requestFormMarkup();
    jest.resetModules();

    jest.doMock('../../src/modules/editorLoader.js', () => {
        const stub = () => new Proxy({}, {
            get: (target, prop) => {
                if (prop === 'then') {
                    return undefined;
                }
                if (!(prop in target)) {
                    target[prop] = jest.fn();
                }
                return target[prop];
            }
        });
        class FakeEditor {
            constructor() {
                return stub();
            }
        }
        return {
            loadEditor: jest.fn(() => Promise.resolve(FakeEditor)),
            warmEditors: jest.fn(),
            createLazyEditorProxy: jest.fn(() => stub())
        };
    });

    const apiHandler = await import('../../src/modules/apiHandler.js');
    const { app } = await import('../../src/modules/appContext.js');
    const { AuthManager } = await import('../../src/modules/authManager.js');
    const authManager = new AuthManager({ typeSelect: null, fieldsContainer: null });
    app.authManager = authManager;
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');

    initTabListeners();

    window.backendAPI = {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({}) },
        history: { add: jest.fn().mockResolvedValue(undefined) },
        sendApiRequest: jest.fn().mockResolvedValue(sendResult)
    };

    const { installTestRequestPipeline } = await import('../helpers/requestPipeline.js');
    await installTestRequestPipeline(app, window.backendAPI);

    const updateTab = jest.fn().mockResolvedValue(undefined);
    app.workspaceTabController = {
        service: { getActiveTabId: jest.fn().mockResolvedValue('tab-1'), updateTab }
    };
    const handleCookiesFromResponse = jest.fn();
    app.cookieController = {
        handleCookiesFromResponse,
        getCookieHeader: jest.fn().mockResolvedValue(null)
    };

    setCurrentEndpoint(null);
    document.getElementById('url-input').value = 'https://api.example.com/items';

    return { ...apiHandler, app, updateTab, handleCookiesFromResponse };
}

afterEach(() => {
    document.body.innerHTML = '';
    delete window.backendAPI;
});

describe('HTTP responses of every status are treated as responses', () => {
    async function withManualScripts() {
        const loaded = await loadApiHandler({ status: 200, success: true, data: {}, headers: {} });
        const { ScriptService } = await import('../../src/modules/services/ScriptService.js');
        const { ScriptController } = await import('../../src/modules/controllers/ScriptController.js');
        const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');
        setCurrentEndpoint({ collectionId: 'c', endpointId: 'e' });
        const environments = { getActiveEnvironment: async () => ({ id: 'env' }), getActiveEnvironmentVariables: async () => ({}), applyVariableChanges: jest.fn() };
        const service = new ScriptService({ getScripts: async () => ({ preRequestScript: 'pre', testScript: 'test' }) }, environments, null, null, { backendAPI: window.backendAPI });
        loaded.app.scriptController = new ScriptController(service, null, { show: jest.fn(), showTestResults: jest.fn() });
        window.backendAPI.scripts = {
            executePreRequest: jest.fn().mockResolvedValue({ success: true, logs: [], errors: [], testResults: [], modifiedLocalVariables: { token: 'fresh' } }),
            executeTest: jest.fn().mockResolvedValue({ success: true, logs: [], errors: [], testResults: [] })
        };
        return loaded;
    }

    test('Manual Send carries locals into request templates and tests, then disposes the scope', async () => {
        const loaded = await withManualScripts();
        document.getElementById('url-input').value = 'https://api.test/{{token}}';
        await loaded.handleSendRequest();
        expect(window.backendAPI.sendApiRequest).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.test/fresh' }));
        expect(window.backendAPI.scripts.executeTest.mock.calls[0][0].localVariables).toEqual({ token: 'fresh' });
        expect(window.backendAPI.scripts.executeTest.mock.calls[0][0].executionContext).toEqual({ runner: false, requestId: 'e' });
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('Manual Send skip is successful and sends neither HTTP nor tests', async () => {
        const loaded = await withManualScripts();
        window.backendAPI.scripts.executePreRequest.mockResolvedValue({ success: true, logs: [], errors: [], testResults: [], execution: { skipped: true, next: { kind: 'unchanged' } } });
        await loaded.handleSendRequest();
        expect(window.backendAPI.sendApiRequest).not.toHaveBeenCalled();
        expect(window.backendAPI.scripts.executeTest).not.toHaveBeenCalled();
        expect(document.getElementById('status-display').textContent).toContain('Skipped');
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test.each([
        ['cancelled', 'failure'], ['cancelled', 'skip'],
        ['replaced', 'failure'], ['replaced', 'skip']
    ])('a %s pre-request script finishing with a late %s leaves newer response and console intact', async (reason, outcome) => {
        const loaded = await withManualScripts();
        let completeOldScript;
        let notifyStarted;
        const started = new Promise(resolve => { notifyStarted = resolve; });
        const oldScript = new Promise(resolve => { completeOldScript = resolve; });
        window.backendAPI.scripts.executePreRequest
            .mockImplementationOnce(() => { notifyStarted(); return oldScript; })
            .mockResolvedValue({ success: true, logs: [], errors: [], testResults: [] });
        let displayedBody = '';
        const container = {
            tabId: 'tab-1', editor: { currentLanguage: 'json', setContent: value => { displayedBody = value; } }
        };
        loaded.app.responseContainerManager = {
            containers: new Map([['tab-1', container]]), getOrCreateContainer: () => container
        };
        const oldSend = loaded.handleSendRequest();
        await started;
        if (reason === 'cancelled') {
            await loaded.handleCancelRequest();
        }
        window.backendAPI.sendApiRequest.mockResolvedValue({
            status: 201, statusText: 'Created', success: true, data: { current: true }, headers: {}
        });
        await loaded.handleSendRequest();
        const currentBody = displayedBody;
        const currentStatus = document.getElementById('status-display').textContent;
        const { consolePanel } = loaded.app.scriptController;
        const shownLogs = consolePanel.show.mock.calls.length;
        const shownTests = consolePanel.showTestResults.mock.calls.length;
        completeOldScript({
            success: outcome !== 'failure',
            logs: [{ level: 'log', message: 'obsolete script output', timestamp: 1 }],
            errors: outcome === 'failure' ? ['obsolete script failure'] : [], testResults: [],
            execution: { skipped: outcome === 'skip', next: { kind: 'unchanged' } }
        });
        await oldSend;

        expect(displayedBody).toBe(currentBody);
        expect(JSON.parse(displayedBody)).toEqual({ current: true });
        expect(document.getElementById('status-display').textContent).toBe(currentStatus);
        expect(consolePanel.show).toHaveBeenCalledTimes(shownLogs);
        expect(consolePanel.showTestResults).toHaveBeenCalledTimes(shownTests);
        expect(window.backendAPI.sendApiRequest).toHaveBeenCalledTimes(1);
        delete loaded.app.responseContainerManager;
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('a pre-request local write retains a freshly renewed request OAuth token during template refresh', async () => {
        const loaded = await withManualScripts();
        const { getRequestPipeline } = await import('../../src/modules/requestServices.js');
        getRequestPipeline().collectionRepository.saveAuthConfigAtSource = jest.fn().mockResolvedValue(undefined);
        loaded.app.authManager.currentAuthConfig = {
            type: 'oauth2', config: {
                token: 'stale', expiresAt: Date.now() - 1000, refreshToken: 'refresh',
                tokenUrl: 'https://auth.test/token', clientId: 'client'
            }
        };
        window.backendAPI.oauth2 = {
            getToken: jest.fn().mockResolvedValue({ success: true, accessToken: 'freshly-renewed', expiresIn: 3600 })
        };
        document.getElementById('url-input').value = 'https://api.test/{{token}}';

        await loaded.handleSendRequest();

        expect(window.backendAPI.oauth2.getToken).toHaveBeenCalledTimes(1);
        expect(window.backendAPI.sendApiRequest).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://api.test/fresh', headers: expect.objectContaining({ Authorization: 'Bearer freshly-renewed' })
        }));
        expect(loaded.app.authManager.currentAuthConfig.config.token).toBe('freshly-renewed');
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('refreshes the captured GraphQL query and variables after a pre-request local write', async () => {
        const loaded = await withManualScripts();
        const { setRequestMode } = await import('../../src/modules/requestModeManager.js');
        setRequestMode('graphql');
        loaded.setGraphQLBodyManager({
            getGraphQLQuery: () => 'query Lookup { user(id: "{{token}}") { name } }',
            getGraphQLVariables: () => '{"token":"{{token}}","nested":{"token":"{{token}}"}}',
            getSelectedOperationName: () => 'Lookup',
            isGraphQLMode: () => true
        });

        await loaded.handleSendRequest();

        expect(window.backendAPI.sendApiRequest).toHaveBeenCalledWith(expect.objectContaining({
            protocol: 'graphql', method: 'POST', body: {
                query: 'query Lookup { user(id: "fresh") { name } }',
                variables: { token: 'fresh', nested: { token: 'fresh' } }, operationName: 'Lookup'
            }
        }));
        loaded.setGraphQLBodyManager(null);
        setRequestMode('http');
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('refreshes form-data text and file templates after a pre-request local write', async () => {
        const loaded = await withManualScripts();
        document.getElementById('body-mode-select').value = 'formdata';
        document.getElementById('method-select').value = 'POST';
        loaded.app.formBodyManager = {
            getFormDataRows: () => [
                { key: 'session', value: '{{token}}', type: 'text', enabled: true },
                { key: 'upload', type: 'file', filePath: '/tmp/{{token}}.json', contentType: 'application/json', enabled: true },
                { key: 'disabled', value: '{{token}}', type: 'text', enabled: false }
            ]
        };

        await loaded.handleSendRequest();

        const sent = window.backendAPI.sendApiRequest.mock.calls[0][0];
        expect(sent.bodyType).toBe('formdata');
        expect(sent.body).toEqual([
            expect.objectContaining({ key: 'session', value: 'fresh', type: 'text' }),
            expect.objectContaining({ key: 'upload', filePath: '/tmp/fresh.json', type: 'file', contentType: 'application/json' })
        ]);
        delete loaded.app.formBodyManager;
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('refreshes inherited templated Bearer auth from pre-request local variables', async () => {
        const loaded = await withManualScripts();
        const { getRequestPipeline } = await import('../../src/modules/requestServices.js');
        loaded.app.authManager.currentAuthConfig = { type: 'inherit', config: {} };
        getRequestPipeline().collectionRepository.getInheritedAuth = jest.fn().mockResolvedValue({
            authConfig: { type: 'bearer', config: { token: '{{token}}' } }, source: { kind: 'collection' }
        });

        await loaded.handleSendRequest();

        expect(window.backendAPI.sendApiRequest).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer fresh' })
        }));
        expect(loaded.app.authManager.currentAuthConfig.type).toBe('inherit');
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('preserves collection base URL and default headers when local writes refresh request templates', async () => {
        const loaded = await withManualScripts();
        const { getRequestPipeline } = await import('../../src/modules/requestServices.js');
        getRequestPipeline().collectionRepository.getById = jest.fn().mockResolvedValue({
            id: 'c', baseUrl: 'https://collection.test',
            defaultHeaders: { 'X-Collection': 'default', 'X-Session': '{{token}}' }
        });
        document.getElementById('url-input').value = '{{baseUrl}}/items/{{token}}';

        await loaded.handleSendRequest();

        expect(window.backendAPI.sendApiRequest).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://collection.test/items/fresh',
            headers: expect.objectContaining({ 'X-Collection': 'default', 'X-Session': 'fresh' })
        }));
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test.each(['header', 'query'])('strips the original generated %s credential after local refresh and a scripted origin change', async location => {
        const loaded = await withManualScripts();
        loaded.app.scriptController.service.environmentService.getActiveEnvironmentVariables = async () => ({ credential: 'original-secret' });
        loaded.app.authManager.currentAuthConfig = location === 'header'
            ? { type: 'bearer', config: { token: '{{credential}}' } }
            : { type: 'api-key', config: { keyName: 'api_key', keyValue: '{{credential}}', location: 'query' } };
        window.backendAPI.scripts.executePreRequest.mockResolvedValue({
            success: true, logs: [], errors: [], testResults: [],
            modifiedLocalVariables: { credential: 'renewed-secret' },
            modifiedRequest: {
                url: 'https://outside.test/collect',
                ...(location === 'header'
                    ? { headers: { Authorization: 'Bearer original-secret', 'X-Script': 'preserved' } }
                    : { queryParams: { api_key: 'original-secret', script: 'preserved' } })
            }
        });

        await loaded.handleSendRequest();

        const sent = window.backendAPI.sendApiRequest.mock.calls[0][0];
        expect(new URL(sent.url).origin).toBe('https://outside.test');
        expect(sent.headers).not.toHaveProperty('Authorization');
        expect(sent.queryParams).not.toHaveProperty('api_key');
        expect(new URL(sent.url).searchParams.has('api_key')).toBe(false);
        expect(JSON.stringify(sent)).not.toContain('original-secret');
        expect(JSON.stringify(sent)).not.toContain('renewed-secret');
        if (location === 'header') {
            expect(sent.headers['X-Script']).toBe('preserved');
        } else {
            expect(sent.queryParams.script).toBe('preserved');
        }
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });

    test('retains the complete live inspection source across tab restores when storage caps its body', async () => {
        const data = { value: 'x'.repeat(500100) };
        const { handleSendRequest, app, updateTab } = await loadApiHandler({
            status: 500, success: false, data, isJson: true, headers: { 'content-type': 'application/json' }
        });
        const inspection = { source: null, setSource: jest.fn(source => { inspection.source = source; }) };
        const container = { tabId: 'tab-1', inspection, editor: { setContent: jest.fn(), currentLanguage: 'json' } };
        const savedResponse = { data: '{truncated', truncated: true, isJson: true };
        updateTab.mockResolvedValue({ response: savedResponse });
        app.responseContainerManager = { containers: new Map([['tab-1', container]]), getOrCreateContainer: () => container };
        await handleSendRequest();
        expect(inspection.source).toEqual({ format: 'json', body: JSON.stringify(data) });
        expect(container.renderedResponse).toBe(savedResponse);
        expect(updateTab.mock.calls[0][1].response.isJson).toBe(true);
        const { WorkspaceTabStateManager } = await import('../../src/modules/WorkspaceTabStateManager.js');
        const before = inspection.setSource.mock.calls.length;
        await new WorkspaceTabStateManager({})._restoreResponse(savedResponse, 'tab-1');
        expect(inspection.setSource).toHaveBeenCalledTimes(before);
        expect(inspection.source.body.length).toBeGreaterThan(500000);
        delete app.responseContainerManager;
        delete app.workspaceTabController;
        delete app.cookieController;
    });

    test('a 500 is saved to the tab with its body and every Set-Cookie header', async () => {
        const { handleSendRequest, updateTab, handleCookiesFromResponse, app } = await loadApiHandler({
            success: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'content-type': 'application/json', 'set-cookie': 'a=1, b=2' },
            setCookies: ['a=1; Path=/', 'b=2; Path=/'],
            data: { error: 'boom' },
            ttfb: 12,
            size: 16
        });

        await handleSendRequest();

        expect(updateTab).toHaveBeenCalledTimes(1);
        const saved = updateTab.mock.calls[0][1].response;
        expect(saved.status).toBe(500);
        expect(saved.data).toEqual({ error: 'boom' });
        expect(saved.cookies.map(c => c.name)).toEqual(['a', 'b']);
        expect(handleCookiesFromResponse).toHaveBeenCalledWith(['a=1; Path=/', 'b=2; Path=/'], 'https://api.example.com/items');
        expect(document.getElementById('status-display').textContent).toContain('500');
        delete app.workspaceTabController;
        delete app.cookieController;
    });

    test('a 200 keeps both cookies instead of the last one', async () => {
        const { handleSendRequest, updateTab, app } = await loadApiHandler({
            success: true,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
            setCookies: ['a=1', 'b=2'],
            data: 'ok'
        });

        await handleSendRequest();

        expect(updateTab.mock.calls[0][1].response.cookies).toHaveLength(2);
        delete app.workspaceTabController;
        delete app.cookieController;
    });

    test('a transport error (no status) is not saved as a response', async () => {
        const { handleSendRequest, updateTab, handleCookiesFromResponse, app } = await loadApiHandler({
            success: false,
            message: 'connection refused'
        });

        await handleSendRequest();

        expect(updateTab).not.toHaveBeenCalled();
        expect(handleCookiesFromResponse).not.toHaveBeenCalled();
        expect(document.getElementById('status-display').textContent).toContain('Request Failed');
        delete app.workspaceTabController;
        delete app.cookieController;
    });
});

describe('cancelling targets the active tab\'s own request', () => {
    async function startPendingSend() {
        let resolveSend;
        const loaded = await loadApiHandler(null);
        window.backendAPI.sendApiRequest = jest.fn(() => new Promise(resolve => { resolveSend = resolve; }));
        window.backendAPI.cancelApiRequest = jest.fn().mockResolvedValue({ success: true });
        const sending = loaded.handleSendRequest();
        for (let i = 0; i < 20 && window.backendAPI.sendApiRequest.mock.calls.length === 0; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return { ...loaded, sending, finish: (value) => resolveSend(value) };
    }

    test('cancel sends the id of the request running in the active tab', async () => {
        const { handleCancelRequest, sending, finish, app } = await startPendingSend();
        const { requestId } = window.backendAPI.sendApiRequest.mock.calls[0][0];

        await handleCancelRequest();

        expect(requestId).toEqual(expect.any(String));
        expect(window.backendAPI.cancelApiRequest).toHaveBeenCalledWith(requestId);
        finish({ cancelled: true, success: false });
        await sending;
        delete app.workspaceTabController;
        delete app.cookieController;
    });

    test('cancel in a different tab does not touch the running request', async () => {
        const { handleCancelRequest, sending, finish, app } = await startPendingSend();
        app.workspaceTabController.service.getActiveTabId.mockResolvedValue('tab-2');

        await handleCancelRequest();

        expect(window.backendAPI.cancelApiRequest).not.toHaveBeenCalled();
        finish({ success: true, status: 200, headers: {}, data: 'ok' });
        await sending;
        delete app.workspaceTabController;
        delete app.cookieController;
    });
});

describe('cancelling a unary gRPC call', () => {
    test('goes to the gRPC cancel command with the tab\'s request id, not the HTTP one', async () => {
        const loaded = await loadApiHandler(null);
        const { setRequestMode } = await import('../../src/modules/requestModeManager.js');
        const { trackInFlight } = await import('../../src/modules/state/inFlightRequests.js');
        setRequestMode('grpc');
        const untrack = trackInFlight('tab-1', 'grpc-req-1');
        window.backendAPI.cancelApiRequest = jest.fn();
        window.backendAPI.grpc = { unaryCancel: jest.fn().mockResolvedValue(true) };

        await loaded.handleCancelRequest();

        expect(window.backendAPI.grpc.unaryCancel).toHaveBeenCalledWith('grpc-req-1');
        expect(window.backendAPI.cancelApiRequest).not.toHaveBeenCalled();
        untrack();
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });
});

describe('OAuth tokens are renewed before sending', () => {
    test('an expired request-level token is refreshed, sent, and shown in the auth form', async () => {
        const loaded = await loadApiHandler({ success: true, status: 200, headers: {}, data: 'ok' });
        const { authManager } = loaded.app;
        authManager.currentAuthConfig = {
            type: 'oauth2',
            config: { token: 'stale', expiresAt: Date.now() - 1000, refreshToken: 'r1', tokenUrl: 'https://auth.test/token', clientId: 'app' }
        };
        window.backendAPI.oauth2 = { getToken: jest.fn().mockResolvedValue({ success: true, accessToken: 'fresh', expiresIn: 60 }) };

        await loaded.handleSendRequest();

        expect(window.backendAPI.oauth2.getToken).toHaveBeenCalledWith(expect.objectContaining({ grantType: 'refresh_token' }));
        const sent = window.backendAPI.sendApiRequest.mock.calls[0][0];
        expect(sent.headers.Authorization).toBe('Bearer fresh');
        expect(authManager.currentAuthConfig.config.token).toBe('fresh');
        expect(authManager.currentAuthConfig.config.expiresAt).toBeGreaterThan(Date.now());
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });
});

describe('a failing pre-request script stops the send', () => {
    test('the request is not sent and the error is shown in its place', async () => {
        const loaded = await loadApiHandler({ success: true, status: 200, headers: {}, data: 'ok' });
        const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');
        const { toast } = await import('../../src/modules/ui/Toast.js');
        const toastError = jest.spyOn(toast, 'error').mockImplementation(() => {});
        setCurrentEndpoint({ collectionId: 'c1', endpointId: 'e1' });
        const scriptError = new Error('ReferenceError: foo is not defined');
        scriptError.name = 'PreRequestScriptError';
        loaded.app.scriptController = { executePreRequest: jest.fn().mockRejectedValue(scriptError) };

        await loaded.handleSendRequest();

        expect(loaded.app.scriptController.executePreRequest).toHaveBeenCalled();
        expect(window.backendAPI.sendApiRequest).not.toHaveBeenCalled();
        expect(document.getElementById('status-display').textContent).toContain('Pre-request script error');
        expect(toastError).toHaveBeenCalledWith(expect.stringContaining('foo is not defined'));
        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
        toastError.mockRestore();
        setCurrentEndpoint(null);
        delete loaded.app.scriptController;
        delete loaded.app.workspaceTabController;
        delete loaded.app.cookieController;
    });
});

