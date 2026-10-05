/**
 * @fileoverview Cookie jar service — stores, matches, and injects cookies per RFC 6265
 * @module services/CookieJarService
 */

import { cookieEnvironmentId, cookieId } from '../utils/cookieId.js';

export class CookieJarService {
    constructor(cookieRepository) {
        this.repository = cookieRepository;
    }

    _canonicalizeDomain(domain) {
        if (!domain) { return ''; }
        return domain.toLowerCase().replace(/^\./, '');
    }

    _matchesDomain(cookieDomain, requestHost, hostOnly) {
        const host = requestHost.toLowerCase();
        const cookieHost = cookieDomain.toLowerCase();
        if (hostOnly) {
            return host === cookieHost;
        }
        return host === cookieHost || host.endsWith(`.${cookieHost}`);
    }

    _matchesPath(cookiePath, requestPath) {
        return cookiePath === '/' || requestPath === cookiePath || requestPath.startsWith(`${cookiePath}/`);
    }

    /**
     * @param {string[]} attrs
     * @returns {{domain: (string|null), path: string, expires: (number|null), maxAge: (number|null), httpOnly: boolean, secure: boolean, sameSite: (string|null), hasDomainAttr: boolean}}
     */
    _parseAttributes(attrs) {
        const parsed = {
            domain: null,
            path: '/',
            expires: null,
            maxAge: null,
            httpOnly: false,
            secure: false,
            sameSite: null,
            hasDomainAttr: false
        };

        for (const attr of attrs) {
            const eqPos = attr.indexOf('=');
            const attrKey = (eqPos >= 0 ? attr.slice(0, eqPos) : attr).trim().toLowerCase();
            const attrVal = eqPos >= 0 ? attr.slice(eqPos + 1).trim() : '';

            switch (attrKey) {
                case 'domain':
                    parsed.domain = this._canonicalizeDomain(attrVal);
                    parsed.hasDomainAttr = true;
                    break;
                case 'path':
                    parsed.path = attrVal || '/';
                    break;
                case 'expires': {
                    const ts = Date.parse(attrVal);
                    if (!isNaN(ts)) { parsed.expires = ts; }
                    break;
                }
                case 'max-age':
                    parsed.maxAge = parseInt(attrVal, 10);
                    break;
                case 'httponly':
                    parsed.httpOnly = true;
                    break;
                case 'secure':
                    parsed.secure = true;
                    break;
                case 'samesite':
                    parsed.sameSite = attrVal || 'None';
                    break;
            }
        }

        return parsed;
    }

    _parseSetCookie(setCookieStr, requestUrl, environmentId) {
        const parts = setCookieStr.split(';').map(p => p.trim());
        const [nameValue, ...attrs] = parts;
        const eqIdx = nameValue.indexOf('=');
        if (eqIdx < 0) { return null; }
        const name = nameValue.slice(0, eqIdx).trim();
        const value = nameValue.slice(eqIdx + 1).trim();
        if (!name) { return null; }

        const attributes = this._parseAttributes(attrs);

        let requestHost;
        try {
            requestHost = new URL(requestUrl).hostname.toLowerCase();
        } catch { return null; }

        const hostOnly = !attributes.hasDomainAttr;
        const domain = attributes.domain || requestHost;

        let { expires } = attributes;
        if (attributes.maxAge !== null) {
            expires = attributes.maxAge <= 0 ? 0 : Date.now() + attributes.maxAge * 1000;
        }

        const envId = cookieEnvironmentId(environmentId);

        return {
            id: cookieId(envId, domain, attributes.path, name),
            environmentId: envId,
            name,
            value,
            domain,
            path: attributes.path,
            expires,
            httpOnly: attributes.httpOnly,
            secure: attributes.secure,
            sameSite: attributes.sameSite,
            hostOnly,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    /**
     * @param {string[]} setCookieHeaders
     * @param {string} requestUrl
     * @param {string} environmentId
     */
    async processCookiesFromResponse(setCookieHeaders, requestUrl, environmentId) {
        if (!setCookieHeaders || setCookieHeaders.length === 0) { return; }

        const envId = cookieEnvironmentId(environmentId);
        const cookies = setCookieHeaders
            .map(header => this._parseSetCookie(header, requestUrl, envId))
            .filter(Boolean);

        if (cookies.length > 0) {
            await this.repository.applyResponseCookies(cookies);
        }
    }

    /**
     * @param {string} requestUrl
     * @param {string} environmentId
     * @returns {Promise<string|null>}
     */
    async getCookieHeaderForRequest(requestUrl, environmentId) {
        await this.repository.deleteExpired();

        const allCookies = await this.repository.getAll(cookieEnvironmentId(environmentId));

        let requestHost = '';
        let requestPath = '/';
        let isHttps = false;
        try {
            const parsed = new URL(requestUrl);
            requestHost = parsed.hostname.toLowerCase();
            requestPath = parsed.pathname || '/';
            isHttps = parsed.protocol === 'https:';
        } catch {
            return null;
        }

        const matching = allCookies.filter(cookie =>
            (!cookie.secure || isHttps)
            && this._matchesDomain(cookie.domain, requestHost, cookie.hostOnly)
            && this._matchesPath(cookie.path, requestPath)
        );

        if (matching.length === 0) { return null; }

        return matching.map(c => `${c.name}=${c.value}`).join('; ');
    }

    /**
     * @param {Object} cookie
     * @returns {string|null}
     */
    validateCookie(cookie) {
        const name = cookie?.name ?? '';
        if (!name.trim()) {
            return 'name_required';
        }
        // eslint-disable-next-line no-control-regex -- control chars are what RFC 6265 forbids here
        if (/[;=\s]/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
            return 'name_invalid';
        }
        const value = cookie?.value ?? '';
        // eslint-disable-next-line no-control-regex -- control chars are what RFC 6265 forbids here
        if (/[;\n\r]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
            return 'value_invalid';
        }
        const domain = this._canonicalizeDomain(cookie?.domain ?? '');
        if (!domain || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(domain)) {
            return 'domain_invalid';
        }
        const path = cookie?.path || '/';
        if (!path.startsWith('/')) {
            return 'path_invalid';
        }
        if (cookie?.expires !== null && cookie?.expires !== undefined) {
            const ts = typeof cookie.expires === 'number' ? cookie.expires : Date.parse(cookie.expires);
            if (isNaN(ts)) {
                return 'expires_invalid';
            }
        }
        return null;
    }

    /**
     * @param {Object} cookie
     * @param {string} environmentId
     * @param {string|null} [originalId]
     * @returns {Promise<Object>}
     */
    async putCookie(cookie, environmentId, originalId = null) {
        const validationError = this.validateCookie(cookie);
        if (validationError) {
            throw new Error(validationError);
        }

        const envId = cookieEnvironmentId(environmentId);
        const domain = this._canonicalizeDomain(cookie.domain);
        const path = cookie.path || '/';
        const name = cookie.name.trim();
        const id = cookieId(envId, domain, path, name);

        let expires = null;
        if (cookie.expires !== null && cookie.expires !== undefined) {
            expires = typeof cookie.expires === 'number' ? cookie.expires : Date.parse(cookie.expires);
        }

        if (originalId && originalId !== id) {
            await this.repository.delete(originalId);
        }

        const stored = {
            id,
            environmentId: envId,
            name,
            value: cookie.value ?? '',
            domain,
            path,
            expires,
            httpOnly: Boolean(cookie.httpOnly),
            secure: Boolean(cookie.secure),
            sameSite: cookie.sameSite || null,
            hostOnly: Boolean(cookie.hostOnly),
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        await this.repository.upsert(stored);
        return stored;
    }

    async getAll(environmentId) {
        return this.repository.getAll(cookieEnvironmentId(environmentId));
    }

    async delete(id) {
        await this.repository.delete(id);
    }

    async deleteAll(environmentId) {
        await this.repository.deleteAll(cookieEnvironmentId(environmentId));
    }

    async deleteSessionCookies(environmentId) {
        const all = await this.repository.getAll(cookieEnvironmentId(environmentId));
        for (const c of all) {
            if (c.expires === null) {
                await this.repository.delete(c.id);
            }
        }
    }
}
