/**
 * @fileoverview Repository for managing workspace tab persistence
 * @module storage/WorkspaceTabRepository
 */

import { truncateBody } from '../utils/truncateBody.js';
import { generateId } from '../utils/ids.js';
import { getSecretAuthFields, isTemplateRef } from '../auth/authSecrets.js';

/** @type {string} */
const MQTT_PASSWORD_KEY = 'mqttPassword';

/** @type {string} */
const AUTH_KEY_PREFIX = 'auth.';

/**
 * @param {Object} request
 * @returns {string[]}
 */
function authSecretFields(request) {
    const config = request?.authConfig;
    if (!config || typeof config !== 'object') {
        return [];
    }
    return getSecretAuthFields(request.authType).filter((field) => {
        const value = config[field];
        return typeof value === 'string' && value !== '' && !isTemplateRef(value);
    });
}

/**
 * @param {Object} tab
 * @returns {Object<string, string>}
 */
function tabSecrets(tab) {
    const request = tab?.request;
    const secrets = {};
    if (!request) {
        return secrets;
    }
    if (typeof request.password === 'string' && request.password !== '') {
        secrets[MQTT_PASSWORD_KEY] = request.password;
    }
    for (const field of authSecretFields(request)) {
        secrets[AUTH_KEY_PREFIX + field] = request.authConfig[field];
    }
    return secrets;
}

/**
 * @param {Object} tab
 * @returns {boolean}
 */
function hasPlaintextSecrets(tab) {
    return Object.keys(tabSecrets(tab)).length > 0;
}

export class WorkspaceTabRepository {
    /**
     * @param {Object} backendAPI
     * @param {Object|null} [secretStore]
     */
    constructor(backendAPI, secretStore = null) {
        this.backendAPI = backendAPI;
        this.secretStore = secretStore;
        this._syncedSecrets = new Map();
        this.STORE_KEY = 'workspace-tabs';
        this.ACTIVE_TAB_KEY = 'active-tab-id';
        this._tabsCache = null;
        this._activeTabIdCache = undefined;
        this._writeChain = Promise.resolve();
        this._queuedWrites = new Map();
    }

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    _queueStoreWrite(key, value) {
        const queued = this._queuedWrites.get(key);
        if (queued) {
            queued.value = value;
            return queued.write;
        }
        const entry = { value, write: null };
        entry.write = this._writeChain
            .catch(() => { })
            .then(async () => {
                this._queuedWrites.delete(key);
                const latest = entry.value;
                if (key === this.STORE_KEY && this.secretStore) {
                    await this._syncTabSecrets(latest);
                    return this.backendAPI.store.set(key, latest.map(tab => this._withoutSecrets(tab)));
                }
                return this.backendAPI.store.set(key, latest);
            });
        this._queuedWrites.set(key, entry);
        this._writeChain = entry.write;
        return entry.write;
    }

    /**
     * @param {string} tabId
     * @returns {string}
     */
    _secretScope(tabId) {
        return `tab:${tabId}`;
    }

    /**
     * @param {Object} tab
     * @returns {Object}
     */
    _withoutSecrets(tab) {
        const request = tab?.request;
        if (!request) {
            return tab;
        }
        const authFields = authSecretFields(request);
        if (!('password' in request) && authFields.length === 0) {
            return tab;
        }
        const scrubbed = { ...request };
        if ('password' in request) {
            scrubbed.password = '';
        }
        if (authFields.length > 0) {
            scrubbed.authConfig = { ...request.authConfig };
            for (const field of authFields) {
                scrubbed.authConfig[field] = '';
            }
        }
        return { ...tab, request: scrubbed };
    }

    /**
     * @param {Array<Object>} tabs
     * @returns {Promise<void>}
     */
    async _syncTabSecrets(tabs) {
        const liveIds = new Set();
        for (const tab of tabs) {
            liveIds.add(tab.id);
            const next = tabSecrets(tab);
            const previous = this._syncedSecrets.get(tab.id) || {};
            const scope = this._secretScope(tab.id);
            for (const key of Object.keys(previous)) {
                if (!(key in next)) {
                    await this.secretStore.delete(scope, key);
                }
            }
            for (const [key, value] of Object.entries(next)) {
                if (previous[key] !== value) {
                    await this.secretStore.set(scope, key, value);
                }
            }
            this._syncedSecrets.set(tab.id, next);
        }
        for (const tabId of [...this._syncedSecrets.keys()]) {
            if (!liveIds.has(tabId)) {
                await this.secretStore.deleteScope(this._secretScope(tabId));
                this._syncedSecrets.delete(tabId);
            }
        }
    }

    /**
     * @param {Array<Object>} tabs
     * @returns {Promise<Array<Object>>}
     */
    async _hydrateTabSecrets(tabs) {
        if (!this.secretStore) {
            return tabs;
        }
        const hydrated = [];
        for (const tab of tabs) {
            if (!tab?.request) {
                hydrated.push(tab);
                continue;
            }
            const stored = await this.secretStore.getScope(this._secretScope(tab.id));
            if (Object.keys(stored).length > 0) {
                this._syncedSecrets.set(tab.id, stored);
            }
            const request = { ...tab.request };
            if (MQTT_PASSWORD_KEY in stored) {
                request.password = stored[MQTT_PASSWORD_KEY];
            } else if (request.protocol === 'mqtt') {
                request.password = request.password ?? '';
            }
            for (const [key, value] of Object.entries(stored)) {
                if (!key.startsWith(AUTH_KEY_PREFIX)) {
                    continue;
                }
                const field = key.slice(AUTH_KEY_PREFIX.length);
                const config = request.authConfig && typeof request.authConfig === 'object' ? request.authConfig : {};
                if (config[field] === '' || config[field] === undefined || config[field] === null) {
                    request.authConfig = { ...config, [field]: value };
                }
            }
            hydrated.push({ ...tab, request });
        }
        return hydrated;
    }

    /** @type {number} */
    static MAX_RESPONSE_SIZE = 500000;

    /** @returns {Promise<Array<Object>>} */
    async getTabs() {
        if (this._tabsCache !== null) {
            return [...this._tabsCache];
        }

        try {
            const data = await this.backendAPI.store.get(this.STORE_KEY);

            if (!data || !Array.isArray(data)) {
                const defaultTabs = [this._createDefaultTab()];
                await this.saveTabs(defaultTabs);
                return [...defaultTabs];
            }

            let hydrated = data;
            try {
                hydrated = await this._hydrateTabSecrets(data);
            } catch {
            }
            this._tabsCache = hydrated;
            if (this.secretStore && data.some(hasPlaintextSecrets)) {
                this._queueStoreWrite(this.STORE_KEY, hydrated).catch(() => { });
            }
            return [...hydrated];
        } catch {
            return [this._createDefaultTab()];
        }
    }

    /**
     * @param {Array<Object>} tabs
     * @returns {Promise<void>}
     */
    async saveTabs(tabs) {
        if (!Array.isArray(tabs)) {
            throw new Error('Tabs must be an array');
        }
        this._tabsCache = tabs;
        await this._queueStoreWrite(this.STORE_KEY, tabs);
    }

    /** @returns {Promise<string|null>} */
    async getActiveTabId() {
        if (this._activeTabIdCache !== undefined) {
            return this._activeTabIdCache;
        }

        try {
            const activeId = await this.backendAPI.store.get(this.ACTIVE_TAB_KEY);
            this._activeTabIdCache = activeId || null;
            return this._activeTabIdCache;
        } catch (error) {
            this._activeTabIdCache = null;
            return null;
        }
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async setActiveTabId(tabId) {
        this._activeTabIdCache = tabId;
        await this._queueStoreWrite(this.ACTIVE_TAB_KEY, tabId).catch(() => { });
    }

    /**
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async getTabById(tabId) {
        const tabs = await this.getTabs();
        const tab = tabs.find(tab => tab.id === tabId);
        return tab || null;
    }

    /**
     * @param {Object} tab
     * @param {string} [tab.id]
     * @param {string} [tab.name]
     * @param {Object} [tab.request]
     * @param {Object} [tab.endpoint]
     * @returns {Promise<Object>}
     */
    async addTab(tab) {
        const tabs = await this.getTabs();
        const newTab = {
            ...this._createDefaultTab(),
            ...tab,
            id: tab.id || this._generateTabId(),
            createdAt: Date.now(),
            lastModifiedAt: Date.now()
        };
        tabs.push(newTab);
        this._tabsCache = tabs;
        this._queueStoreWrite(this.STORE_KEY, tabs).catch(() => { });
        return newTab;
    }

    /**
     * @param {string} tabId
     * @param {Object} updates
     * @param {Object} [updates.request]
     * @param {Object} [updates.response]
     * @param {Object} [updates.endpoint]
     * @param {string} [updates.name]
     * @param {boolean} [updates.isModified]
     * @returns {Promise<Object|null>}
     */
    async updateTab(tabId, updates) {
        const tabs = await this.getTabs();
        const index = tabs.findIndex(tab => tab.id === tabId);

        if (index === -1) {
            return null;
        }

        const existingTab = {
            ...this._createDefaultTab(),
            ...tabs[index]
        };

        const mergedRequest = updates.request ?
            { ...(existingTab.request || {}), ...updates.request } :
            existingTab.request;

        let mergedResponse = updates.response !== undefined ?
            updates.response : existingTab.response;

        if (updates.response !== undefined && mergedResponse?.bodyBase64?.length > WorkspaceTabRepository.MAX_RESPONSE_SIZE) {
            mergedResponse = { ...mergedResponse, bodyBase64: null, truncated: true };
        }

        if (updates.response !== undefined && mergedResponse?.data) {
            const capped = truncateBody(
                mergedResponse.data,
                WorkspaceTabRepository.MAX_RESPONSE_SIZE
            );
            if (capped.truncated) {
                mergedResponse = {
                    ...mergedResponse,
                    data: capped.value,
                    truncated: true
                };
            }
        }

        const mergedEndpoint = (updates.endpoint && existingTab.endpoint) ?
            { ...existingTab.endpoint, ...updates.endpoint } :
            (updates.endpoint || existingTab.endpoint);

        const { request: _r, response: _res, endpoint: _e, ...restUpdates } = updates;

        const mergedTab = {
            ...existingTab,
            ...restUpdates,
            request: mergedRequest,
            response: mergedResponse,
            endpoint: mergedEndpoint,
            id: tabId,
            lastModifiedAt: Date.now()
        };

        tabs[index] = mergedTab;

        this._tabsCache = tabs;
        this._queueStoreWrite(this.STORE_KEY, tabs).catch(() => { });

        return tabs[index];
    }

    /**
     * @param {string} tabId
     * @returns {Promise<boolean>}
     */
    async deleteTab(tabId) {
        return this.deleteTabs([tabId]);
    }

    /**
     * @param {Array<string>} tabIds
     * @returns {Promise<boolean>}
     */
    async deleteTabs(tabIds) {
        const ids = new Set(tabIds);
        const tabs = await this.getTabs();
        const filteredTabs = tabs.filter(tab => !ids.has(tab.id));

        if (filteredTabs.length === tabs.length) {
            return false;
        }

        if (filteredTabs.length === 0) {
            filteredTabs.push(this._createDefaultTab());
        }

        this._tabsCache = filteredTabs;
        await this._queueStoreWrite(this.STORE_KEY, filteredTabs).catch(() => { });
        return true;
    }

    /**
     * @param {Array<string>} orderedTabIds
     * @returns {Promise<void>}
     */
    async reorderTabs(orderedTabIds) {
        const tabs = await this.getTabs();
        const tabMap = new Map(tabs.map(t => [t.id, t]));
        const reordered = orderedTabIds.map(id => tabMap.get(id)).filter(Boolean);
        await this.saveTabs(reordered);
    }

    /** @returns {Object} */
    _createDefaultTab() {
        return {
            id: this._generateTabId(),
            name: 'New Request',
            isModified: false,
            request: {
                url: '',
                method: 'GET',
                pathParams: {},
                queryParams: {},
                headers: { 'Content-Type': 'application/json' },
                body: '',
                authType: 'none',
                authConfig: {}
            },
            response: {
                data: null,
                headers: {},
                status: null,
                statusText: '',
                ttfb: null,
                size: null,
                timings: null,
                cookies: []
            },
            endpoint: null,
            createdAt: Date.now(),
            lastModifiedAt: Date.now()
        };
    }

    /** @returns {string} */
    _generateTabId() {
        return generateId('tab', { length: 9, separator: '-' });
    }
}
