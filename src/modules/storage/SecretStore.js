/**
 * @fileoverview Facade for storing and retrieving secret values out of band
 * @module storage/SecretStore
 */

/**
 * Plaintext fallback backend: secrets stored under the `secretValues` store key as
 * `{ scope: { key: value } }`. Used when no OS keychain is available.
 */
export class StoreBackend {
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.STORE_KEY = 'secretValues';
        this._cache = null;
    }

    async _load() {
        if (this._cache !== null) {
            return this._cache;
        }
        const data = await this.backendAPI.store.get(this.STORE_KEY);
        this._cache = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        return this._cache;
    }

    async _persist() {
        await this.backendAPI.store.set(this.STORE_KEY, this._cache || {});
    }

    async get(scope, key) {
        const data = await this._load();
        return data[scope] ? data[scope][key] : undefined;
    }

    async getScope(scope) {
        const data = await this._load();
        return { ...(data[scope] || {}) };
    }

    async has(scope, key) {
        const data = await this._load();
        return Boolean(data[scope] && Object.prototype.hasOwnProperty.call(data[scope], key));
    }

    async set(scope, key, value) {
        const data = await this._load();
        if (!data[scope]) {
            data[scope] = {};
        }
        data[scope][key] = value;
        await this._persist();
    }

    async delete(scope, key) {
        const data = await this._load();
        if (data[scope] && Object.prototype.hasOwnProperty.call(data[scope], key)) {
            delete data[scope][key];
            if (Object.keys(data[scope]).length === 0) {
                delete data[scope];
            }
            await this._persist();
        }
    }

    async rename(scope, oldKey, newKey) {
        if (oldKey === newKey) {
            return;
        }
        const data = await this._load();
        if (data[scope] && Object.prototype.hasOwnProperty.call(data[scope], oldKey)) {
            data[scope][newKey] = data[scope][oldKey];
            delete data[scope][oldKey];
            await this._persist();
        }
    }

    async deleteScope(scope) {
        const data = await this._load();
        if (data[scope]) {
            delete data[scope];
            await this._persist();
        }
    }

    async deleteScopePrefix(prefix) {
        const data = await this._load();
        let changed = false;
        for (const scope of Object.keys(data)) {
            if (scope.startsWith(prefix)) {
                delete data[scope];
                changed = true;
            }
        }
        if (changed) {
            await this._persist();
        }
    }
}

/**
 * Keychain backend: values live in the OS keychain; the `secretIndex` store key holds a
 * non-sensitive index `{ scope: { key: true } }` so scopes can be enumerated without
 * keeping any secret value in the plaintext store.
 */
export class KeychainBackend {
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.INDEX_KEY = 'secretIndex';
        this._index = null;
    }

    /**
     * Opaque keychain account string for a (scope, key) pair.
     *
     * @private
     */
    _account(scope, key) {
        return `${scope}|${key}`;
    }

    async _loadIndex() {
        if (this._index !== null) {
            return this._index;
        }
        const data = await this.backendAPI.store.get(this.INDEX_KEY);
        this._index = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        return this._index;
    }

    async _persistIndex() {
        await this.backendAPI.store.set(this.INDEX_KEY, this._index || {});
    }

    /**
     * Moves any plaintext secrets from a legacy store key into the keychain, then clears
     * the plaintext copies. No-op when there is nothing to migrate.
     *
     * @param {string} legacyKey - Store key holding `{ scope: { key: value } }`
     * @returns {Promise<void>}
     */
    async migrateFrom(legacyKey) {
        const legacy = await this.backendAPI.store.get(legacyKey);
        if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) || Object.keys(legacy).length === 0) {
            return;
        }
        const index = await this._loadIndex();
        for (const [scope, entries] of Object.entries(legacy)) {
            if (!entries || typeof entries !== 'object') {
                continue;
            }
            for (const [key, value] of Object.entries(entries)) {
                await this.backendAPI.secrets.set(this._account(scope, key), String(value));
                if (!index[scope]) {
                    index[scope] = {};
                }
                index[scope][key] = true;
            }
        }
        await this._persistIndex();
        // Clear the plaintext copies now that they live in the keychain.
        await this.backendAPI.store.set(legacyKey, {});
    }

    async get(scope, key) {
        const index = await this._loadIndex();
        if (!index[scope] || !index[scope][key]) {
            return undefined;
        }
        const value = await this.backendAPI.secrets.get(this._account(scope, key));
        return value === null || value === undefined ? undefined : value;
    }

    async getScope(scope) {
        const index = await this._loadIndex();
        const keys = index[scope] ? Object.keys(index[scope]) : [];
        const result = {};
        for (const key of keys) {
            const value = await this.backendAPI.secrets.get(this._account(scope, key));
            if (value !== null && value !== undefined) {
                result[key] = value;
            }
        }
        return result;
    }

    async has(scope, key) {
        const index = await this._loadIndex();
        return Boolean(index[scope] && index[scope][key]);
    }

    async set(scope, key, value) {
        await this.backendAPI.secrets.set(this._account(scope, key), value);
        const index = await this._loadIndex();
        if (!index[scope]) {
            index[scope] = {};
        }
        index[scope][key] = true;
        await this._persistIndex();
    }

    async delete(scope, key) {
        const index = await this._loadIndex();
        if (!index[scope] || !index[scope][key]) {
            return;
        }
        await this.backendAPI.secrets.delete(this._account(scope, key));
        delete index[scope][key];
        if (Object.keys(index[scope]).length === 0) {
            delete index[scope];
        }
        await this._persistIndex();
    }

    async rename(scope, oldKey, newKey) {
        if (oldKey === newKey) {
            return;
        }
        const value = await this.get(scope, oldKey);
        if (value === undefined) {
            return;
        }
        await this.set(scope, newKey, value);
        await this.delete(scope, oldKey);
    }

    async deleteScope(scope) {
        const index = await this._loadIndex();
        if (!index[scope]) {
            return;
        }
        for (const key of Object.keys(index[scope])) {
            await this.backendAPI.secrets.delete(this._account(scope, key));
        }
        delete index[scope];
        await this._persistIndex();
    }

    async deleteScopePrefix(prefix) {
        const index = await this._loadIndex();
        const scopes = Object.keys(index).filter(scope => scope.startsWith(prefix));
        if (scopes.length === 0) {
            return;
        }
        for (const scope of scopes) {
            for (const key of Object.keys(index[scope])) {
                await this.backendAPI.secrets.delete(this._account(scope, key));
            }
            delete index[scope];
        }
        await this._persistIndex();
    }
}

/**
 * Facade for secret values that must never be written into git-friendly collection
 * files or included in exports.
 *
 * @class
 * @classdesc Secrets are keyed by a `scope` (e.g. `env:<environmentId>`,
 * `auth:<collectionId>:<endpointId>`, or `collvar:<collectionId>`) and a `key` (variable
 * name or auth field).
 *
 * Two interchangeable backends sit behind one public surface, chosen once at first use:
 *  - {@link KeychainBackend}: values live in the OS keychain (encryption at rest); the
 *    plaintext store holds only a non-sensitive index of which secrets exist.
 *  - {@link StoreBackend}: values live in the `secretValues` store key. Used as a
 *    fallback when no usable keychain is available (headless/locked systems), and the
 *    behavior the app shipped with before keychain support.
 *
 * When the keychain is available, any values previously kept in `secretValues` are
 * migrated into the keychain on first use and the plaintext copies cleared.
 */
export class SecretStore {
    /**
     * @param {Object} backendAPI - The backend IPC API bridge (provides `store` and,
     *   when available, `secrets`).
     * @param {Object} [options]
     * @param {Function} [options.onFallback] - Called once if the keychain is
     *   unavailable and the plaintext fallback is used (e.g. to surface a UI warning).
     */
    constructor(backendAPI, { onFallback } = {}) {
        this.backendAPI = backendAPI;
        this.onFallback = typeof onFallback === 'function' ? onFallback : null;
        this._backend = null;
        this._initPromise = null;
        this.usingKeychain = null;
    }

    /**
     * Selects and prepares the backend exactly once.
     *
     * @private
     * @returns {Promise<Object>} The active backend
     */
    async _init() {
        if (this._backend) {
            return this._backend;
        }
        if (!this._initPromise) {
            this._initPromise = this._select();
        }
        return this._initPromise;
    }

    /**
     * @private
     * @returns {Promise<Object>}
     */
    async _select() {
        let available = false;
        try {
            available = Boolean(this.backendAPI.secrets) && await this.backendAPI.secrets.keychainAvailable();
        } catch (error) {
            available = false;
        }

        if (available) {
            const backend = new KeychainBackend(this.backendAPI);
            await backend.migrateFrom('secretValues');
            this.usingKeychain = true;
            this._backend = backend;
        } else {
            this.usingKeychain = false;
            this._backend = new StoreBackend(this.backendAPI);
            if (this.onFallback) {
                try { this.onFallback(); } catch (_e) { /* never let a warning hook break secrets */ }
            }
        }
        return this._backend;
    }

    /** @param {string} scope @param {string} key @returns {Promise<string|undefined>} */
    async get(scope, key) {
        return (await this._init()).get(scope, key);
    }

    /** @param {string} scope @returns {Promise<Object>} */
    async getScope(scope) {
        return (await this._init()).getScope(scope);
    }

    /** @param {string} scope @param {string} key @returns {Promise<boolean>} */
    async has(scope, key) {
        return (await this._init()).has(scope, key);
    }

    /** @param {string} scope @param {string} key @param {string} value @returns {Promise<void>} */
    async set(scope, key, value) {
        return (await this._init()).set(scope, key, value);
    }

    /** @param {string} scope @param {string} key @returns {Promise<void>} */
    async delete(scope, key) {
        return (await this._init()).delete(scope, key);
    }

    /** @param {string} scope @param {string} oldKey @param {string} newKey @returns {Promise<void>} */
    async rename(scope, oldKey, newKey) {
        return (await this._init()).rename(scope, oldKey, newKey);
    }

    /** @param {string} scope @returns {Promise<void>} */
    async deleteScope(scope) {
        return (await this._init()).deleteScope(scope);
    }

    /** @param {string} prefix @returns {Promise<void>} */
    async deleteScopePrefix(prefix) {
        return (await this._init()).deleteScopePrefix(prefix);
    }
}
