/**
 * @fileoverview Repository for managing cookie jar persistence
 * @module storage/CookieRepository
 */

export class CookieRepository {
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.COOKIE_JAR_KEY = 'cookieJar';
    }

    async _getArrayFromStore() {
        try {
            let data = await this.backendAPI.store.get(this.COOKIE_JAR_KEY);
            if (!Array.isArray(data)) {
                data = [];
                await this.backendAPI.store.set(this.COOKIE_JAR_KEY, data);
            }
            return data;
        } catch (_e) {
            return [];
        }
    }

    async _save(cookies) {
        await this.backendAPI.store.set(this.COOKIE_JAR_KEY, cookies);
    }

    /**
     * Returns all cookies for an environment (or all if environmentId is omitted).
     */
    async getAll(environmentId) {
        const cookies = await this._getArrayFromStore();
        if (environmentId === undefined) {
            return cookies;
        }
        return cookies.filter(c => c.environmentId === environmentId);
    }

    /**
     * Insert or update a cookie. ID is `${domain}|${path}|${name}`.
     */
    async upsert(cookie) {
        const cookies = await this._getArrayFromStore();
        const idx = cookies.findIndex(c => c.id === cookie.id);
        if (idx >= 0) {
            cookies[idx] = { ...cookies[idx], ...cookie, updatedAt: Date.now() };
        } else {
            cookies.push({ ...cookie, createdAt: Date.now(), updatedAt: Date.now() });
        }
        await this._save(cookies);
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

    /**
     * Remove cookies whose absolute expiry has passed.
     */
    async deleteExpired() {
        const now = Date.now();
        const cookies = await this._getArrayFromStore();
        await this._save(cookies.filter(c => c.expires === null || c.expires > now));
    }
}
