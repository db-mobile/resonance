/**
 * @fileoverview Repository for managing workspace tab persistence
 * @module storage/WorkspaceTabRepository
 */

import logger from '../logger.js';

const _log = logger.scope('WorkspaceTabRepository');

/**
 * Repository for managing workspace tab persistence
 *
 * @class
 * @classdesc Handles persistence of workspace tabs (multiple request tabs) in the persistent store.
 * Each tab contains complete request/response state including URL, method, headers, body,
 * query params, authentication config, and response data. Implements defensive programming
 * with deep cloning to avoid reference issues and auto-initialization for packaged apps.
 * Ensures at least one tab always exists.
 */
export class WorkspaceTabRepository {
    /**
     * Creates a WorkspaceTabRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.STORE_KEY = 'workspace-tabs';
        this.ACTIVE_TAB_KEY = 'active-tab-id';
    }

    /**
     * Retrieves all workspace tabs
     *
     * Automatically initializes with default tab if data is invalid. Uses deep cloning
     * to avoid reference issues between tabs.
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of workspace tab objects
     */
    async getTabs() {
        try {
            const data = await this.backendAPI.store.get(this.STORE_KEY);

            // Validate and initialize if needed
            if (!data || !Array.isArray(data)) {
                const defaultTabs = [this._createDefaultTab()];
                await this.saveTabs(defaultTabs);
                return defaultTabs;
            }

            // Deep clone to avoid reference issues
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            const defaultTabs = [this._createDefaultTab()];
            await this.saveTabs(defaultTabs);
            return defaultTabs;
        }
    }

    /**
     * Saves all workspace tabs
     *
     * @async
     * @param {Array<Object>} tabs - Array of tab objects to save
     * @returns {Promise<void>}
     * @throws {Error} If tabs is not an array or save fails
     */
    async saveTabs(tabs) {
        if (!Array.isArray(tabs)) {
            throw new Error('Tabs must be an array');
        }
        await this.backendAPI.store.set(this.STORE_KEY, tabs);
    }

    /**
     * Retrieves the active tab ID
     *
     * @async
     * @returns {Promise<string|null>} The active tab ID or null
     */
    async getActiveTabId() {
        try {
            const activeId = await this.backendAPI.store.get(this.ACTIVE_TAB_KEY);
            return activeId || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Sets the active tab ID
     *
     * @async
     * @param {string} tabId - The tab ID to set as active
     * @returns {Promise<void>}
     * @throws {Error} If save fails
     */
    async setActiveTabId(tabId) {
        await this.backendAPI.store.set(this.ACTIVE_TAB_KEY, tabId);
    }

    /**
     * Retrieves a tab by ID
     *
     * Uses deep cloning to avoid reference issues.
     *
     * @async
     * @param {string} tabId - The tab ID
     * @returns {Promise<Object|null>} The tab object or null if not found
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
     * Adds a new workspace tab
     *
     * Merges provided tab data with default tab structure. Generates ID and timestamps.
     *
     * @async
     * @param {Object} tab - Tab object with initial data
     * @param {string} [tab.id] - Optional tab ID (generated if not provided)
     * @param {string} [tab.name] - Tab name
     * @param {Object} [tab.request] - Request configuration
     * @param {Object} [tab.endpoint] - Associated endpoint data
     * @returns {Promise<Object>} The created tab object
     * @throws {Error} If save fails
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
     * Updates an existing workspace tab
     *
     * Deep merges nested objects to preserve sub-properties. Uses deep cloning to ensure
     * each tab has isolated data. Response is completely replaced instead of merged.
     *
     * @async
     * @param {string} tabId - The tab ID to update
     * @param {Object} updates - Object with properties to update
     * @param {Object} [updates.request] - Request updates (deep merged)
     * @param {Object} [updates.response] - Response data (completely replaced)
     * @param {Object} [updates.endpoint] - Endpoint updates (deep merged)
     * @param {string} [updates.name] - Tab name
     * @param {boolean} [updates.isModified] - Modified state
     * @returns {Promise<Object|null>} The updated tab object or null if not found
     * @throws {Error} If save fails
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
     * Deletes a workspace tab
     *
     * Ensures at least one tab always exists. If deleting the last tab, creates a new default tab.
     *
     * @async
     * @param {string} tabId - The tab ID to delete
     * @returns {Promise<boolean>} True if deletion succeeded, false if tab not found
     * @throws {Error} If save fails
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
     * Creates a default workspace tab
     *
     * Provides initial structure for new tabs with empty request/response data.
     *
     * @private
     * @returns {Object} Default tab object
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
     * Generates a unique tab ID
     *
     * @private
     * @returns {string} Unique tab ID
     */
    _generateTabId() {
        return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Clears all tabs and creates a new default tab
     *
     * Resets workspace to initial state with single empty tab.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If save fails
     */
    async clearAllTabs() {
        const defaultTabs = [this._createDefaultTab()];
        await this.saveTabs(defaultTabs);
        await this.setActiveTabId(defaultTabs[0].id);
    }
}
