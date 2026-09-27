/* global document */
import { AuthManager, setOAuthVariableResolver } from '../../src/modules/authManager.js';
import { api } from '../../src/modules/ipcBridge.js';
import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';

describe('OAuth2 token requests resolve {{variables}}', () => {
    let authManager;
    let getToken;
    let resolver;

    beforeEach(() => {
        document.body.innerHTML = '<select id="auth-type-select"></select><div id="auth-fields-container"></div>';
        authManager = new AuthManager({
            typeSelect: document.getElementById('auth-type-select'),
            fieldsContainer: document.getElementById('auth-fields-container'),
            collectionId: 'col-1'
        });
        getToken = jest.spyOn(api.oauth2, 'getToken').mockResolvedValue({
            success: true,
            accessToken: 'at-1',
            refreshToken: 'rt-2'
        });
        resolver = jest.fn().mockResolvedValue({
            variables: { secret: 's3cr3t', host: 'auth.example.com' },
            processor: new VariableProcessor()
        });
        setOAuthVariableResolver(resolver);
    });

    afterEach(() => {
        getToken.mockRestore();
        setOAuthVariableResolver(null);
    });

    test('client_credentials sends the resolved secret and URL, scoped to the collection', async () => {
        authManager.currentAuthConfig = {
            type: 'oauth2',
            config: {
                grantType: 'client_credentials',
                tokenUrl: 'https://{{host}}/token',
                clientId: 'app',
                clientSecret: '{{secret}}'
            }
        };

        await authManager._handleGetToken(null, null);

        expect(resolver).toHaveBeenCalledWith('col-1');
        expect(getToken).toHaveBeenCalledWith(expect.objectContaining({
            tokenUrl: 'https://auth.example.com/token',
            clientSecret: 's3cr3t'
        }));
    });

    test('the stored config keeps its templates while receiving the new tokens', async () => {
        authManager.currentAuthConfig = {
            type: 'oauth2',
            config: { grantType: 'client_credentials', tokenUrl: 'https://{{host}}/token', clientSecret: '{{secret}}' }
        };

        await authManager._handleGetToken(null, null);

        expect(authManager.currentAuthConfig.config.clientSecret).toBe('{{secret}}');
        expect(authManager.currentAuthConfig.config.token).toBe('at-1');
        expect(authManager.currentAuthConfig.config.refreshToken).toBe('rt-2');
    });

    test('refresh resolves variables too', async () => {
        authManager.currentAuthConfig = {
            type: 'oauth2',
            config: { tokenUrl: 'https://{{host}}/token', clientSecret: '{{secret}}', refreshToken: 'rt-1' }
        };

        await authManager._handleRefreshToken(null, null);

        expect(getToken).toHaveBeenCalledWith(expect.objectContaining({
            grantType: 'refresh_token',
            tokenUrl: 'https://auth.example.com/token',
            clientSecret: 's3cr3t',
            refreshToken: 'rt-1'
        }));
    });
});
