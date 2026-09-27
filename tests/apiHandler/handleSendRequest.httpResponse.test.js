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
    jest.doMock('../../src/modules/collectionManager.js', () => ({
        saveAllRequestModifications: jest.fn().mockResolvedValue(undefined),
        saveRequestToCollection: jest.fn(),
        getCollections: jest.fn().mockResolvedValue([])
    }));

    const apiHandler = await import('../../src/modules/apiHandler.js');
    const { app } = await import('../../src/modules/appContext.js');
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');

    initTabListeners();

    window.backendAPI = {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({}) },
        history: { add: jest.fn().mockResolvedValue(undefined) },
        sendApiRequest: jest.fn().mockResolvedValue(sendResult)
    };

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
        const { authManager } = await import('../../src/modules/authManager.js');
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

