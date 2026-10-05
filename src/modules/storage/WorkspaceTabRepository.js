/**
 * @fileoverview Repository for managing workspace tab persistence
 * @module storage/WorkspaceTabRepository
 */

import { truncateBody } from '../utils/truncateBody.js';
import { generateId } from '../utils/ids.js';

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
        if (!tab?.request || !('password' in tab.request)) {
            return tab;
        }
        return { ...tab, request: { ...tab.request, password: '' } };
    }

    /**
     * @param {Array<Object>} tabs
     * @returns {Promise<void>}
     */
    async _syncTabSecrets(tabs) {
        const liveIds = new Set();
        for (const tab of tabs) {
            liveIds.add(tab.id);
            const password = tab.request?.password || '';
            if (this._syncedSecrets.get(tab.id) === password) {
                continue;
            }
            if (password) {
                await this.secretStore.set(this._secretScope(tab.id), 'mqttPassword', password);
            } else {
                await this.secretStore.delete(this._secretScope(tab.id), 'mqttPassword');
            }
            this._syncedSecrets.set(tab.id, password);
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
            if (tab?.request?.protocol !== 'mqtt') {
                hydrated.push(tab);
                continue;
            }
            const stored = await this.secretStore.get(this._secretScope(tab.id), 'mqttPassword');
            if (stored !== undefined && stored !== null) {
                this._syncedSecrets.set(tab.id, stored);
            }
            const password = stored ?? tab.request.password ?? '';
            hydrated.push({ ...tab, request: { ...tab.request, password } });
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
            if (this.secretStore && data.some(tab => tab?.request?.password)) {
                this._queueStoreWrite(this.STORE_KEY, hydrated).catch(() => { });
            }
            return [...hydrated];
        } catch (error) {
            const defaultTabs = [this._createDefaultTab()];
            this._tabsCache = defaultTabs;
            return [...defaultTabs];
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
