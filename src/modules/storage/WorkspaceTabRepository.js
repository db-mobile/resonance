/**
 * WorkspaceTabRepository
 *
 * Handles persistence of workspace tabs (multiple request tabs).
 * Each tab contains complete request/response state.
 */
import logger from '../logger.js';

const _log = logger.scope('WorkspaceTabRepository');

export class WorkspaceTabRepository {
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.STORE_KEY = 'workspace-tabs';
        this.ACTIVE_TAB_KEY = 'active-tab-id';
    }

    /**
     * Get all workspace tabs
     * @returns {Promise<Array>}
     */
    async getTabs() {
        try {
            const data = await this.electronAPI.store.get(this.STORE_KEY);

            // Validate and initialize if needed
            if (!data || !Array.isArray(data)) {
                const defaultTabs = [this._createDefaultTab()];
                await this.saveTabs(defaultTabs);
                return defaultTabs;
            }

            // Deep clone to avoid reference issues
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            console.error('Error getting workspace tabs:', error);
            const defaultTabs = [this._createDefaultTab()];
            await this.saveTabs(defaultTabs);
            return defaultTabs;
        }
    }

    /**
     * Save all workspace tabs
     * @param {Array} tabs
     * @returns {Promise<void>}
     */
    async saveTabs(tabs) {
        try {
            if (!Array.isArray(tabs)) {
                throw new Error('Tabs must be an array');
            }
            await this.electronAPI.store.set(this.STORE_KEY, tabs);
        } catch (error) {
            console.error('Error saving workspace tabs:', error);
            throw error;
        }
    }

    /**
     * Get active tab ID
     * @returns {Promise<string|null>}
     */
    async getActiveTabId() {
        try {
            const activeId = await this.electronAPI.store.get(this.ACTIVE_TAB_KEY);
            return activeId || null;
        } catch (error) {
            console.error('Error getting active tab ID:', error);
            return null;
        }
    }

    /**
     * Set active tab ID
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async setActiveTabId(tabId) {
        try {
            await this.electronAPI.store.set(this.ACTIVE_TAB_KEY, tabId);
        } catch (error) {
            console.error('Error setting active tab ID:', error);
            throw error;
        }
    }

    /**
     * Get tab by ID
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async getTabById(tabId) {
        const tabs = await this.getTabs();
        const tab = tabs.find(tab => tab.id === tabId);

        // Deep clone to avoid reference issues
        if (tab) {
            return JSON.parse(JSON.stringify(tab));
        }
        return null;
    }

    /**
     * Add a new tab
     * @param {Object} tab
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
        await this.saveTabs(tabs);
        return newTab;
    }

    /**
     * Update an existing tab
     * @param {string} tabId
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async updateTab(tabId, updates) {
        const tabs = await this.getTabs();
        const index = tabs.findIndex(tab => tab.id === tabId);

        if (index === -1) {
            return null;
        }

        // Ensure existing tab has proper structure
        const existingTab = {
            ...this._createDefaultTab(),
            ...tabs[index]
        };

        // Deep merge nested objects first to avoid shallow overwrite
        // Use JSON parse/stringify to create deep clones and avoid reference issues
        const mergedRequest = updates.request ?
            JSON.parse(JSON.stringify({
                ...(existingTab.request || {}),
                ...updates.request
            })) : JSON.parse(JSON.stringify(existingTab.request));

        // For response, completely replace instead of merge
        // Deep clone to ensure each tab has its own isolated response data
        const mergedResponse = updates.response !== undefined ?
            JSON.parse(JSON.stringify(updates.response)) :
            JSON.parse(JSON.stringify(existingTab.response));

        const mergedEndpoint = (updates.endpoint && existingTab.endpoint) ?
            JSON.parse(JSON.stringify({
                ...existingTab.endpoint,
                ...updates.endpoint
            })) : (updates.endpoint ? JSON.parse(JSON.stringify(updates.endpoint)) : JSON.parse(JSON.stringify(existingTab.endpoint)));

        // Create merged tab, excluding nested objects from updates
        const { request: _r, response: _res, endpoint: _e, ...restUpdates } = updates;

        const mergedTab = {
            ...existingTab,
            ...restUpdates,
            request: mergedRequest,
            response: mergedResponse,
            endpoint: mergedEndpoint,
            id: tabId, // Ensure ID doesn't change
            lastModifiedAt: Date.now()
        };

        tabs[index] = mergedTab;

        await this.saveTabs(tabs);

        return tabs[index];
    }

    /**
     * Delete a tab
     * @param {string} tabId
     * @returns {Promise<boolean>}
     */
    async deleteTab(tabId) {
        const tabs = await this.getTabs();
        const filteredTabs = tabs.filter(tab => tab.id !== tabId);

        if (filteredTabs.length === tabs.length) {
            return false; // Tab not found
        }

        // Ensure at least one tab exists
        if (filteredTabs.length === 0) {
            filteredTabs.push(this._createDefaultTab());
        }

        await this.saveTabs(filteredTabs);
        return true;
    }

    /**
     * Create a default tab
     * @returns {Object}
     */
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

    /**
     * Generate a unique tab ID
     * @returns {string}
     */
    _generateTabId() {
        return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clear all tabs and create a new default tab
     * @returns {Promise<void>}
     */
    async clearAllTabs() {
        const defaultTabs = [this._createDefaultTab()];
        await this.saveTabs(defaultTabs);
        await this.setActiveTabId(defaultTabs[0].id);
    }
}
