/* global document, window, DOMParser */
import fs from 'fs';
import path from 'path';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

async function loadManager(config) {
    jest.resetModules();
    const getToken = jest.fn(async () => ({ success: true, accessToken: 'fresh', expiresIn: 60, refreshToken: 'r2', tokenType: 'Bearer' }));
    window.backendAPI = {
        oauth2: {
            getToken,
            getPkceVerifier: jest.fn(async () => 'verifier'),
            generateState: jest.fn(async () => 'state'),
            generatePkce: jest.fn(async () => ({ codeVerifier: 'v', codeChallenge: 'c', codeChallengeMethod: 'S256' })),
            storePkceVerifier: jest.fn(async () => {}),
            buildAuthorizationUrl: jest.fn(async () => 'https://auth.test/authorize')
        }
    };
    jest.doMock('../../src/modules/ipcBridge.js', () => ({ api: window.backendAPI, default: window.backendAPI }));
    const { AuthManager } = await import('../../src/modules/authManager.js');
    const { templateLoader } = await import('../../src/modules/templateLoader.js');
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/auth/authFields.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
    document.body.innerHTML = '<select id="auth-type-select"></select><div id="auth-fields-container"></div>';
    const manager = new AuthManager({
        typeSelect: document.getElementById('auth-type-select'),
        fieldsContainer: document.getElementById('auth-fields-container')
    });
    manager.loadAuthConfig({ type: 'oauth2', config });
    return { manager, getToken };
}

afterEach(() => {
    delete window.backendAPI;
});

describe('AuthManager token requests', () => {
    test('client_credentials sends the base request with scope and audience', async () => {
        const { manager, getToken } = await loadManager({
            grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: 's', scope: 'read', audience: 'aud', clientAuthMethod: 'header'
        });

        await manager._handleGetToken(null, null);

        expect(getToken).toHaveBeenCalledWith({
            grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: 's',
            scope: 'read', audience: 'aud', clientAuthMethod: 'header'
        });
        expect(manager.getAuthConfig().config).toMatchObject({ token: 'fresh', refreshToken: 'r2' });
        expect(manager.getAuthConfig().config.expiresAt).toBeGreaterThan(Date.now());
    });

    test('password adds the credentials and defaults the optional fields', async () => {
        const { manager, getToken } = await loadManager({
            grantType: 'password', tokenUrl: 'https://auth.test/token', clientId: 'id', username: 'u', password: 'p'
        });

        await manager._handleGetToken(null, null);

        expect(getToken).toHaveBeenCalledWith({
            grantType: 'password', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: null,
            scope: null, audience: null, clientAuthMethod: 'body', username: 'u', password: 'p'
        });
    });

    test('refresh_token sends the stored refresh token', async () => {
        const { manager, getToken } = await loadManager({
            grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', refreshToken: 'r1'
        });

        await manager._handleRefreshToken(null, null);

        expect(getToken).toHaveBeenCalledWith({
            grantType: 'refresh_token', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: null,
            refreshToken: 'r1', clientAuthMethod: 'body'
        });
    });

    test('authorization_code exchanges the code with the PKCE verifier and default redirect uri', async () => {
        const { manager, getToken } = await loadManager({
            grantType: 'authorization_code', tokenUrl: 'https://auth.test/token', clientId: 'id', _pendingState: 'state'
        });

        await manager._exchangeAuthorizationCode('the-code');

        expect(getToken).toHaveBeenCalledWith({
            grantType: 'authorization_code', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: null,
            authorizationCode: 'the-code', redirectUri: 'http://localhost:8080/callback', codeVerifier: 'verifier', clientAuthMethod: 'body'
        });
        expect(manager.getAuthConfig().config._pendingState).toBeUndefined();
    });

    test('a failed token response leaves the token alone', async () => {
        const { manager, getToken } = await loadManager({ grantType: 'client_credentials', tokenUrl: 'u', clientId: 'id', token: 'old' });
        getToken.mockResolvedValue({ success: false, error: 'invalid_client' });

        await manager._handleGetToken(null, null);

        expect(manager.getAuthConfig().config.token).toBe('old');
    });
});
