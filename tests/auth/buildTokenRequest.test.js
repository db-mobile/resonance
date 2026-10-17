import { buildTokenRequest, buildRenewalRequest } from '../../src/modules/auth/oauthRefresh.js';

const CONFIG = { tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: 's', scope: 'read', audience: 'aud', username: 'u', password: 'p', refreshToken: 'r' };

describe('buildTokenRequest', () => {
    test('client_credentials and password carry scope, audience and credentials', () => {
        expect(buildTokenRequest(CONFIG, 'client_credentials')).toEqual({
            grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: 's', clientAuthMethod: 'body', scope: 'read', audience: 'aud'
        });
        expect(buildTokenRequest(CONFIG, 'password')).toEqual(expect.objectContaining({ grantType: 'password', username: 'u', password: 'p' }));
    });

    test('refresh_token carries only the refresh token', () => {
        expect(buildTokenRequest(CONFIG, 'refresh_token')).toEqual({
            grantType: 'refresh_token', tokenUrl: 'https://auth.test/token', clientId: 'id', clientSecret: 's', clientAuthMethod: 'body', refreshToken: 'r'
        });
    });

    test('authorization_code carries the code, verifier and a default redirect uri', () => {
        expect(buildTokenRequest({ tokenUrl: 'u', clientId: 'id' }, 'authorization_code', { authorizationCode: 'c' })).toEqual({
            grantType: 'authorization_code', tokenUrl: 'u', clientId: 'id', clientSecret: null, clientAuthMethod: 'body',
            authorizationCode: 'c', redirectUri: 'http://localhost:8080/callback', codeVerifier: null
        });
        expect(buildTokenRequest({ ...CONFIG, redirectUri: 'app://cb', clientAuthMethod: 'header' }, 'authorization_code', { authorizationCode: 'c', codeVerifier: 'v' }))
            .toEqual(expect.objectContaining({ redirectUri: 'app://cb', codeVerifier: 'v', clientAuthMethod: 'header' }));
    });

    test('buildRenewalRequest prefers a refresh token, then a repeatable grant, else nothing', () => {
        expect(buildRenewalRequest(CONFIG).grantType).toBe('refresh_token');
        expect(buildRenewalRequest({ ...CONFIG, refreshToken: undefined, grantType: 'password' })).toEqual(buildTokenRequest({ ...CONFIG, refreshToken: undefined }, 'password'));
        expect(buildRenewalRequest({ ...CONFIG, refreshToken: undefined, grantType: 'authorization_code' })).toBeNull();
    });
});
