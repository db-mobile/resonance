/**
 * @fileoverview Automatic OAuth 2.0 token renewal before a request is sent
 * @module auth/oauthRefresh
 */

/** @type {number} */
export const REFRESH_SKEW_MS = 30000;

/** @type {ReadonlySet<string>} */
const REPEATABLE_GRANTS = new Set(['client_credentials', 'password']);

/** @type {Map<string, Promise<Object|null>>} */
const inFlight = new Map();

/**
 * @param {Object|null|undefined} config
 * @param {number} [now]
 * @returns {boolean}
 */
export function tokenNeedsRefresh(config, now = Date.now()) {
    if (!config?.token || typeof config.expiresAt !== 'number') {
        return false;
    }
    return now >= config.expiresAt - REFRESH_SKEW_MS;
}

/**
 * @param {Object} config
 * @returns {Object|null}
 */
export function buildRenewalRequest(config) {
    const base = {
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret || null,
        clientAuthMethod: config.clientAuthMethod || 'body'
    };
    if (config.refreshToken) {
        return { ...base, grantType: 'refresh_token', refreshToken: config.refreshToken };
    }
    const grantType = config.grantType || 'client_credentials';
    if (!REPEATABLE_GRANTS.has(grantType)) {
        return null;
    }
    const request = { ...base, grantType, scope: config.scope || null, audience: config.audience || null };
    if (grantType === 'password') {
        request.username = config.username;
        request.password = config.password;
    }
    return request;
}

/**
 * @param {Object} config
 * @param {Object} result
 * @param {number} [now]
 * @returns {Object}
 */
export function applyTokenResult(config, result, now = Date.now()) {
    const next = { ...config, token: result.accessToken };
    if (result.expiresIn) {
        next.expiresAt = now + result.expiresIn * 1000;
    } else {
        delete next.expiresAt;
    }
    if (result.refreshToken) {
        next.refreshToken = result.refreshToken;
    }
    return next;
}

/**
 * @param {{collectionId?: string, endpointId?: string}|null} endpoint
 * @param {{kind: string, folderId?: string}} source
 * @returns {string}
 */
export function oauthRefreshKey(endpoint, source) {
    const collectionId = endpoint?.collectionId ?? '';
    if (source.kind === 'folder') {
        return `${collectionId}|folder|${source.folderId}`;
    }
    if (source.kind === 'collection') {
        return `${collectionId}|collection`;
    }
    return `${collectionId}|request|${endpoint?.endpointId ?? 'unsaved'}`;
}

/**
 * @param {Object} options
 * @param {Object} options.rawAuth
 * @param {Object} options.resolvedAuth
 * @param {string} options.key
 * @param {function(Object): Promise<Object>} options.getToken
 * @param {function(Object, Object): Promise<void>} options.persist
 * @returns {Promise<{rawAuth: Object, resolvedAuth: Object, refreshed: boolean, error: (string|null)}>}
 */
export async function ensureFreshOAuthToken({ rawAuth, resolvedAuth, key, getToken, persist }) {
    const unchanged = { rawAuth, resolvedAuth, refreshed: false, error: null };
    if (resolvedAuth?.type !== 'oauth2' || !tokenNeedsRefresh(resolvedAuth.config)) {
        return unchanged;
    }
    const request = buildRenewalRequest(resolvedAuth.config);
    if (!request) {
        return { ...unchanged, error: 'The OAuth token has expired and this grant type cannot renew it automatically; use Get Token.' };
    }

    if (!inFlight.has(key)) {
        const renewal = (async () => {
            const result = await getToken(request);
            if (!result?.success || !result.accessToken) {
                throw new Error(result?.errorDescription || result?.error || 'token endpoint returned no access token');
            }
            return result;
        })();
        inFlight.set(key, renewal);
        renewal.then(() => inFlight.delete(key), () => inFlight.delete(key));
    }

    let result;
    try {
        result = await inFlight.get(key);
    } catch (error) {
        return { ...unchanged, error: `OAuth token refresh failed: ${error.message}` };
    }

    const now = Date.now();
    const nextRaw = { ...rawAuth, config: applyTokenResult(rawAuth.config || {}, result, now) };
    const nextResolved = { ...resolvedAuth, config: applyTokenResult(resolvedAuth.config, result, now) };
    try {
        await persist(nextRaw, result);
    } catch (error) {
        void error;
    }
    return { rawAuth: nextRaw, resolvedAuth: nextResolved, refreshed: true, error: null };
}
