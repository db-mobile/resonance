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
