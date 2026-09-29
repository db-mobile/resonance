/**
 * @fileoverview Repository for managing cookie jar persistence
 * @module storage/CookieRepository
 */

export class CookieRepository {
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.COOKIE_JAR_KEY = 'cookieJar';
        this._cookies = null;
    }

    async _getArrayFromStore() {
        if (this._cookies) {
            return this._cookies;
        }
        try {
            let data = await this.backendAPI.store.get(this.COOKIE_JAR_KEY);
            if (!Array.isArray(data)) {
                data = [];
                await this.backendAPI.store.set(this.COOKIE_JAR_KEY, data);
            }
            this._cookies = await this._migrateLegacyIds(data);
            return this._cookies;
        } catch (_e) {
            return [];
        }
    }

    async _migrateLegacyIds(cookies) {
        let changed = false;
        const byId = new Map();
        for (const cookie of cookies) {
            const envId = cookie.environmentId || 'default';
            const id = `${envId}|${cookie.domain}|${cookie.path}|${cookie.name}`;
            const migrated = id === cookie.id ? cookie : { ...cookie, id, environmentId: envId };
            if (migrated !== cookie) {
                changed = true;
            }
            const existing = byId.get(id);
            if (!existing || (migrated.updatedAt || 0) > (existing.updatedAt || 0)) {
                byId.set(id, migrated);
            }
        }
        if (byId.size !== cookies.length) {
            changed = true;
        }
        if (!changed) {
            return cookies;
        }
        const result = [...byId.values()];
        await this._save(result);
        return result;
    }

    async _save(cookies) {
        await this.backendAPI.store.set(this.COOKIE_JAR_KEY, cookies);
        this._cookies = cookies;
    }

    async getAll(environmentId) {
        const cookies = await this._getArrayFromStore();
        if (environmentId === undefined) {
            return [...cookies];
        }
        return cookies.filter(c => c.environmentId === environmentId);
    }

    async upsert(cookie) {
        const cookies = await this._getArrayFromStore();
        const idx = cookies.findIndex(c => c.id === cookie.id);
        const next = [...cookies];
        if (idx >= 0) {
            next[idx] = { ...cookies[idx], ...cookie, updatedAt: Date.now() };
        } else {
            next.push({ ...cookie, createdAt: Date.now(), updatedAt: Date.now() });
        }
        await this._save(next);
    }

    /**
     * @param {Object[]} cookies
     * @returns {Promise<void>}
     */
    async applyResponseCookies(cookies) {
        const now = Date.now();
        const byId = new Map((await this._getArrayFromStore()).map(c => [c.id, c]));
        for (const cookie of cookies) {
            if (cookie.expires !== null && cookie.expires <= now) {
                byId.delete(cookie.id);
                continue;
            }
            const existing = byId.get(cookie.id);
            byId.set(cookie.id, existing
                ? { ...existing, ...cookie, updatedAt: now }
                : { ...cookie, createdAt: now, updatedAt: now });
        }
        await this._save([...byId.values()].filter(c => c.expires === null || c.expires > now));
    }

    async delete(id) {
        const cookies = await this._getArrayFromStore();
        await this._save(cookies.filter(c => c.id !== id));
    }

    async deleteAll(environmentId) {
        const cookies = await this._getArrayFromStore();
        await this._save(cookies.filter(c => c.environmentId !== environmentId));
    }

    async deleteByDomain(domain, environmentId) {
        const cookies = await this._getArrayFromStore();
        await this._save(cookies.filter(c => !(c.domain === domain && c.environmentId === environmentId)));
    }

    async deleteExpired() {
        const now = Date.now();
        const cookies = await this._getArrayFromStore();
        const live = cookies.filter(c => c.expires === null || c.expires > now);
        if (live.length !== cookies.length) {
            await this._save(live);
        }
    }
}
