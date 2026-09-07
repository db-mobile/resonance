/**
 * @fileoverview Repository for managing workspace tab persistence
 * @module storage/WorkspaceTabRepository
 */



export class WorkspaceTabRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.STORE_KEY = 'workspace-tabs';
        this.ACTIVE_TAB_KEY = 'active-tab-id';
        this._tabsCache = null;
        this._activeTabIdCache = undefined;
        this._writeChain = Promise.resolve();
    }

    /**
     * @param {string} key
     * @param {*} value
     * @returns {Promise<void>}
     */
    _queueStoreWrite(key, value) {
        const write = this._writeChain
            .catch(() => { })
            .then(() => this.backendAPI.store.set(key, value));
        this._writeChain = write;
        return write;
    }

    /** @returns {Promise<Array<Object>>} */
    static MAX_RESPONSE_SIZE = 500000;

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

            this._tabsCache = data;
            return [...data];
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
            const dataStr = typeof mergedResponse.data === 'string'
                ? mergedResponse.data
                : JSON.stringify(mergedResponse.data);
            if (dataStr.length > WorkspaceTabRepository.MAX_RESPONSE_SIZE) {
                mergedResponse = {
                    ...mergedResponse,
                    data: dataStr.substring(0, WorkspaceTabRepository.MAX_RESPONSE_SIZE),
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
        const tabs = await this.getTabs();
        const filteredTabs = tabs.filter(tab => tab.id !== tabId);

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
        return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /** @returns {Promise<void>} */
    async clearAllTabs() {
        const defaultTabs = [this._createDefaultTab()];
        await this.saveTabs(defaultTabs);
        await this.setActiveTabId(defaultTabs[0].id);
    }
}
