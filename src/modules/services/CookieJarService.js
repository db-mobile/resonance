/**
 * @fileoverview Cookie jar service — stores, matches, and injects cookies per RFC 6265
 * @module services/CookieJarService
 */

export class CookieJarService {
    constructor(cookieRepository) {
        this.repository = cookieRepository;
        this.listeners = new Set();
    }

    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    _notify(event) {
        for (const cb of this.listeners) {
            try { cb(event); } catch (_e) { /* non-blocking */ }
        }
    }

    // -------------------------------------------------------------------------
    // RFC 6265 §5.1.2 — canonicalize domain (lowercase, strip leading dot)
    // -------------------------------------------------------------------------
    _canonicalizeDomain(domain) {
        if (!domain) { return ''; }
        return domain.toLowerCase().replace(/^\./, '');
    }

    // -------------------------------------------------------------------------
    // RFC 6265 §5.1.3 — domain match
    // cookieDomain was stored without leading dot.
    // If the Set-Cookie attribute had a Domain= value, subdomain matching applies.
    // If not (hostOnly flag), only exact match is allowed.
    // -------------------------------------------------------------------------
    _matchesDomain(cookieDomain, requestHost, hostOnly) {
        const host = requestHost.toLowerCase();
        const cd = cookieDomain.toLowerCase();
        if (hostOnly) {
            return host === cd;
        }
        // Exact match or subdomain
        return host === cd || host.endsWith(`.${ cd}`);
    }

    // -------------------------------------------------------------------------
    // RFC 6265 §5.1.4 — path match
    // -------------------------------------------------------------------------
    _matchesPath(cookiePath, requestPath) {
        if (cookiePath === '/') { return true; }
        if (requestPath === cookiePath) { return true; }
        if (requestPath.startsWith(`${cookiePath  }/`)) { return true; }
        return false;
    }

    // -------------------------------------------------------------------------
    // Parse a single Set-Cookie header string into a storable cookie object
    // -------------------------------------------------------------------------
    _parseSetCookie(setCookieStr, requestUrl, environmentId) {
        const parts = setCookieStr.split(';').map(p => p.trim());
        const [nameValue, ...attrs] = parts;
        const eqIdx = nameValue.indexOf('=');
        if (eqIdx < 0) { return null; }
        const name = nameValue.slice(0, eqIdx).trim();
        const value = nameValue.slice(eqIdx + 1).trim();
        if (!name) { return null; }

        let domain = null;
        let path = '/';
        let expires = null;
        let maxAge = null;
        let httpOnly = false;
        let secure = false;
        let sameSite = null;
        let hasDomainAttr = false;

        for (const attr of attrs) {
            const eqPos = attr.indexOf('=');
            const attrKey = (eqPos >= 0 ? attr.slice(0, eqPos) : attr).trim().toLowerCase();
            const attrVal = eqPos >= 0 ? attr.slice(eqPos + 1).trim() : '';

            switch (attrKey) {
                case 'domain':
                    domain = this._canonicalizeDomain(attrVal);
                    hasDomainAttr = true;
                    break;
                case 'path':
                    path = attrVal || '/';
                    break;
                case 'expires':
                    try {
                        const ts = Date.parse(attrVal);
                        if (!isNaN(ts)) { expires = ts; }
                    } catch (_e) { /* ignore */ }
                    break;
                case 'max-age':
                    maxAge = parseInt(attrVal, 10);
                    break;
                case 'httponly':
                    httpOnly = true;
                    break;
                case 'secure':
                    secure = true;
                    break;
                case 'samesite':
                    sameSite = attrVal || 'None';
                    break;
            }
        }

        // Resolve domain from request URL if not provided
        let requestHost = '';
        try {
            requestHost = new URL(requestUrl).hostname.toLowerCase();
        } catch (_e) { return null; }

        const hostOnly = !hasDomainAttr;
        if (!domain) {
            domain = requestHost;
        }

        // Max-Age takes precedence over Expires
        if (maxAge !== null) {
            if (maxAge <= 0) {
                expires = 0; // Mark for immediate deletion
            } else {
                expires = Date.now() + maxAge * 1000;
            }
        }

        const id = `${domain}|${path}|${name}`;

        return {
            id,
            environmentId: environmentId || 'default',
            name,
            value,
            domain,
            path,
            expires: expires,
            httpOnly,
            secure,
            sameSite,
            hostOnly,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Process Set-Cookie headers from a response and persist them to the jar.
     * @param {string[]} setCookieHeaders - Array of raw Set-Cookie header values
     * @param {string} requestUrl - The URL of the request that produced the response
     * @param {string} environmentId - Active environment ID (or 'default')
     */
    async processCookiesFromResponse(setCookieHeaders, requestUrl, environmentId) {
        if (!setCookieHeaders || setCookieHeaders.length === 0) { return; }

        const envId = environmentId || 'default';
        let changed = false;

        for (const header of setCookieHeaders) {
            const cookie = this._parseSetCookie(header, requestUrl, envId);
            if (!cookie) { continue; }

            if (cookie.expires !== null && cookie.expires <= Date.now()) {
                // Max-Age=0 or expired Expires — delete if present
                await this.repository.delete(cookie.id);
            } else {
                await this.repository.upsert(cookie);
            }
            changed = true;
        }

        if (changed) {
            await this.repository.deleteExpired();
            this._notify({ type: 'cookies-updated', environmentId: envId });
        }
    }

    /**
     * Build the Cookie header value for a request.
     * Returns null if no matching cookies.
     * @param {string} requestUrl
     * @param {string} environmentId
     * @returns {Promise<string|null>}
     */
    async getCookieHeaderForRequest(requestUrl, environmentId) {
        await this.repository.deleteExpired();

        const envId = environmentId || 'default';
        const allCookies = await this.repository.getAll(envId);

        let requestHost = '';
        let requestPath = '/';
        let isHttps = false;
        try {
            const parsed = new URL(requestUrl);
            requestHost = parsed.hostname.toLowerCase();
            requestPath = parsed.pathname || '/';
            isHttps = parsed.protocol === 'https:';
        } catch (_e) {
            return null;
        }

        const matching = allCookies.filter(cookie => {
            if (cookie.secure && !isHttps) { return false; }
            if (!this._matchesDomain(cookie.domain, requestHost, cookie.hostOnly)) { return false; }
            if (!this._matchesPath(cookie.path, requestPath)) { return false; }
            return true;
        });

        if (matching.length === 0) { return null; }

        return matching.map(c => `${c.name}=${c.value}`).join('; ');
    }

    async getAll(environmentId) {
        return this.repository.getAll(environmentId || 'default');
    }

    async delete(id) {
        await this.repository.delete(id);
        this._notify({ type: 'cookies-updated' });
    }

    async deleteAll(environmentId) {
        await this.repository.deleteAll(environmentId || 'default');
        this._notify({ type: 'cookies-cleared', environmentId: environmentId || 'default' });
    }

    async deleteByDomain(domain, environmentId) {
        await this.repository.deleteByDomain(domain, environmentId || 'default');
        this._notify({ type: 'cookies-updated', environmentId: environmentId || 'default' });
    }

    /**
     * Delete only session cookies (expires === null) for the given environment.
     */
    async deleteSessionCookies(environmentId) {
        const envId = environmentId || 'default';
        const all = await this.repository.getAll(envId);
        for (const c of all) {
            if (c.expires === null) {
                await this.repository.delete(c.id);
            }
        }
        this._notify({ type: 'cookies-updated', environmentId: envId });
    }
}
