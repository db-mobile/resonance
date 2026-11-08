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
            this._cookies = data;
            return this._cookies;
        } catch (_e) {
            return [];
        }
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

    async delete(id) {
        const cookies = await this._getArrayFromStore();
        await this._save(cookies.filter(c => c.id !== id));
    }

    async deleteAll(environmentId) {
        const cookies = await this._getArrayFromStore();
        await this._save(cookies.filter(c => c.environmentId !== environmentId));
    }
}
