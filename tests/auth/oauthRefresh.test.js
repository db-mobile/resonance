import {
    REFRESH_SKEW_MS,
    applyTokenResult,
    buildRenewalRequest,
    ensureFreshOAuthToken,
    oauthRefreshKey,
    tokenNeedsRefresh
} from '../../src/modules/auth/oauthRefresh.js';

const expired = (config = {}) => ({
    type: 'oauth2',
    config: { token: 'old', expiresAt: Date.now() - 1000, tokenUrl: 'https://auth.test/token', clientId: 'app', ...config }
});

describe('tokenNeedsRefresh', () => {
    test('only tokens with a known expiry inside the skew window need renewal', () => {
        const now = 1_000_000;
        expect(tokenNeedsRefresh({ token: 't', expiresAt: now + REFRESH_SKEW_MS - 1 }, now)).toBe(true);
        expect(tokenNeedsRefresh({ token: 't', expiresAt: now + REFRESH_SKEW_MS + 1000 }, now)).toBe(false);
        expect(tokenNeedsRefresh({ token: 't' }, now)).toBe(false);
        expect(tokenNeedsRefresh({ expiresAt: now - 1 }, now)).toBe(false);
    });
});

describe('buildRenewalRequest', () => {
    test('prefers the refresh token', () => {
        expect(buildRenewalRequest({ tokenUrl: 'u', clientId: 'c', refreshToken: 'r', grantType: 'authorization_code' }))
            .toMatchObject({ grantType: 'refresh_token', refreshToken: 'r', clientAuthMethod: 'body' });
    });

    test('repeats client_credentials and password grants', () => {
        expect(buildRenewalRequest({ grantType: 'client_credentials', scope: 's' })).toMatchObject({ grantType: 'client_credentials', scope: 's' });
        expect(buildRenewalRequest({ grantType: 'password', username: 'u', password: 'p' }))
            .toMatchObject({ grantType: 'password', username: 'u', password: 'p' });
    });

    test('cannot renew an authorization-code token without a refresh token', () => {
        expect(buildRenewalRequest({ grantType: 'authorization_code' })).toBeNull();
    });
});

describe('applyTokenResult', () => {
    test('stores the new token and expiry, keeping the old refresh token when none is returned', () => {
        const next = applyTokenResult({ token: 'a', refreshToken: 'r1', expiresAt: 1 }, { accessToken: 'b', expiresIn: 60 }, 1000);
        expect(next).toEqual({ token: 'b', refreshToken: 'r1', expiresAt: 61000 });
    });

    test('drops a stale expiry when the new token has none', () => {
        expect(applyTokenResult({ token: 'a', expiresAt: 1 }, { accessToken: 'b' }, 1000)).toEqual({ token: 'b' });
    });
});

describe('ensureFreshOAuthToken', () => {
    test('renews with resolved values and persists the raw config with its templates', async () => {
        const raw = expired({ clientSecret: '{{secret}}', grantType: 'client_credentials' });
        const resolved = expired({ clientSecret: 's3cr3t', grantType: 'client_credentials' });
        const getToken = jest.fn().mockResolvedValue({ success: true, accessToken: 'new', expiresIn: 3600 });
        const persist = jest.fn().mockResolvedValue(undefined);

        const outcome = await ensureFreshOAuthToken({ rawAuth: raw, resolvedAuth: resolved, key: 'k1', getToken, persist });

        expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ grantType: 'client_credentials', clientSecret: 's3cr3t' }));
        expect(outcome.refreshed).toBe(true);
        expect(outcome.resolvedAuth.config.token).toBe('new');
        const [persisted] = persist.mock.calls[0];
        expect(persisted.config.clientSecret).toBe('{{secret}}');
        expect(persisted.config.token).toBe('new');
        expect(persisted.config.expiresAt).toBeGreaterThan(Date.now());
    });

    test('concurrent sends share one renewal', async () => {
        let finish;
        const getToken = jest.fn(() => new Promise(resolve => { finish = resolve; }));
        const args = { rawAuth: expired({ refreshToken: 'r' }), resolvedAuth: expired({ refreshToken: 'r' }), key: 'shared', getToken, persist: jest.fn() };

        const first = ensureFreshOAuthToken(args);
        const second = ensureFreshOAuthToken(args);
        finish({ success: true, accessToken: 'once' });

        const results = await Promise.all([first, second]);
        expect(getToken).toHaveBeenCalledTimes(1);
        expect(results.map(r => r.resolvedAuth.config.token)).toEqual(['once', 'once']);
    });

    test('a failed renewal keeps the old token and reports why', async () => {
        const getToken = jest.fn().mockResolvedValue({ success: false, error: 'invalid_grant', errorDescription: 'refresh token revoked' });
        const persist = jest.fn();

        const outcome = await ensureFreshOAuthToken({
            rawAuth: expired({ refreshToken: 'r' }), resolvedAuth: expired({ refreshToken: 'r' }), key: 'k2', getToken, persist
        });

        expect(outcome.refreshed).toBe(false);
        expect(outcome.resolvedAuth.config.token).toBe('old');
        expect(outcome.error).toContain('refresh token revoked');
        expect(persist).not.toHaveBeenCalled();
    });

    test('a valid token or a non-OAuth auth is left alone', async () => {
        const getToken = jest.fn();
        const fresh = { type: 'oauth2', config: { token: 't', expiresAt: Date.now() + 3600_000 } };

        await ensureFreshOAuthToken({ rawAuth: fresh, resolvedAuth: fresh, key: 'k3', getToken, persist: jest.fn() });
        await ensureFreshOAuthToken({ rawAuth: { type: 'bearer' }, resolvedAuth: { type: 'bearer' }, key: 'k4', getToken, persist: jest.fn() });

        expect(getToken).not.toHaveBeenCalled();
    });

    test('an expired authorization-code token without a refresh token reports that it cannot renew', async () => {
        const auth = expired({ grantType: 'authorization_code' });
        const outcome = await ensureFreshOAuthToken({ rawAuth: auth, resolvedAuth: auth, key: 'k5', getToken: jest.fn(), persist: jest.fn() });
        expect(outcome.error).toContain('cannot renew');
    });
});

describe('oauthRefreshKey', () => {
    const endpoint = { collectionId: 'c1', endpointId: 'e1' };

    test('keys a renewal by where the token is stored', () => {
        expect(oauthRefreshKey(endpoint, { kind: 'folder', folderId: 'f1' })).toBe('c1|folder|f1');
        expect(oauthRefreshKey(endpoint, { kind: 'collection' })).toBe('c1|collection');
        expect(oauthRefreshKey(endpoint, { kind: 'request' })).toBe('c1|request|e1');
    });

    test('an unsaved request still gets a stable key', () => {
        expect(oauthRefreshKey(null, { kind: 'request' })).toBe('|request|unsaved');
    });
});
