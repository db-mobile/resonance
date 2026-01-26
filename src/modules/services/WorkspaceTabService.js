/**
 * @fileoverview Service for workspace tab management business logic
 * @module services/WorkspaceTabService
 */

/**
 * Service for workspace tab management business logic
 *
 * @class
 * @classdesc Provides high-level tab operations including creation, switching, closing,
 * and state management. Coordinates between repository and controller layers. Implements
 * observer pattern for tab change notifications. Manages active tab state and ensures
 * at least one tab always exists. Supports tab duplication, renaming, and modification
 * tracking for unsaved changes indication.
 *
 * Event types emitted:
 * - 'tab-created': When a new tab is created
 * - 'tab-switched': When active tab changes
 * - 'tab-closed': When a tab is closed
 * - 'tab-updated': When tab data is modified
 * - 'tab-renamed': When tab is renamed
 * - 'tab-duplicated': When tab is duplicated
 * - 'tabs-cleared': When all tabs are cleared
 */
import logger from '../logger.js';

const log = logger.scope('WorkspaceTabService');

export class WorkspaceTabService {
    /**
     * Creates a WorkspaceTabService instance
     *
     * @param {WorkspaceTabRepository} repository - Data access layer for tabs
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(repository, statusDisplay) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.listeners = [];
    }

    /**
     * Initializes the tab service
     *
     * Ensures at least one tab exists and sets active tab.
     *
     * @async
     * @returns {Promise<Object>} Object with tabs array and activeTabId
     * @throws {Error} If initialization fails
     */
    async initialize() {
        try {
            const tabs = await this.repository.getTabs();
            let activeTabId = await this.repository.getActiveTabId();

            // Ensure active tab exists
            if (!activeTabId || !tabs.find(t => t.id === activeTabId)) {
                activeTabId = tabs[0]?.id || null;
                if (activeTabId) {
                    await this.repository.setActiveTabId(activeTabId);
                }
            }

            return {
                tabs,
                activeTabId
            };
        } catch (error) {
            this.statusDisplay?.updateStatus('Error initializing workspace tabs', null);
            throw error;
        }
    }

    /**
     * Gets all tabs
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of tab objects
     */
    async getAllTabs() {
        return this.repository.getTabs();
    }

    /**
     * Gets the active tab
     *
     * @async
     * @returns {Promise<Object|null>} Active tab object or null if none active
     */
    async getActiveTab() {
        const activeTabId = await this.repository.getActiveTabId();
        if (!activeTabId) {return null;}
        return this.repository.getTabById(activeTabId);
    }

    /**
     * Gets the active tab ID
     *
     * @async
     * @returns {Promise<string|null>} Active tab ID or null if none active
     */
    async getActiveTabId() {
        return this.repository.getActiveTabId();
    }

    /**
     * Creates a new tab
     *
     * @async
     * @param {Object} [options={}] - Tab creation options
     * @param {string} [options.name] - Tab name
     * @param {Object} [options.requestData] - Initial request data
     * @returns {Promise<Object>} The created tab object
     * @throws {Error} If creation fails
     * @fires WorkspaceTabService#tab-created
     */
    async createTab(options = {}) {
        try {
            const newTab = await this.repository.addTab(options);
            this._notifyListeners('tab-created', newTab);
            return newTab;
        } catch (error) {
            this.statusDisplay?.updateStatus('Error creating tab', null);
            throw error;
        }
    }

    /**
     * Switches to a different tab
     *
     * @async
     * @param {string} tabId - The ID of tab to switch to
     * @returns {Promise<Object|null>} The switched-to tab or null if not found
     * @throws {Error} If switch fails
     * @fires WorkspaceTabService#tab-switched
     */
    async switchTab(tabId) {
        try {
            const tab = await this.repository.getTabById(tabId);
            if (!tab) {
                log.warn('Tab not found', { tabId });
                return null;
            }

            await this.repository.setActiveTabId(tabId);
            this._notifyListeners('tab-switched', tab);
            return tab;
        } catch (error) {
            this.statusDisplay?.updateStatus('Error switching tab', null);
            throw error;
        }
    }

    /**
     * Closes a tab
     *
     * Prevents closing the last tab. Automatically switches to another tab
     * if closing the active tab.
     *
     * @async
     * @param {string} tabId - The ID of tab to close
     * @returns {Promise<Object|null>} Object with closedTab and newActiveTabId, or null if cannot close
     * @throws {Error} If close fails
     * @fires WorkspaceTabService#tab-closed
     */
    async closeTab(tabId) {
        try {
            const tabs = await this.repository.getTabs();
            const tabIndex = tabs.findIndex(t => t.id === tabId);

            if (tabIndex === -1) {
                return null;
            }

            // Prevent closing the last tab
            if (tabs.length === 1) {
                this.statusDisplay?.updateStatus('Cannot close the last tab', null);
                return null;
            }

            const closedTab = tabs[tabIndex];
            const activeTabId = await this.repository.getActiveTabId();

            // If closing the active tab, switch to another tab
            let newActiveTabId = activeTabId;
            if (tabId === activeTabId) {
                // Switch to the next tab, or the previous one if this is the last tab
                const newIndex = tabIndex < tabs.length - 1 ? tabIndex + 1 : tabIndex - 1;
                newActiveTabId = tabs[newIndex].id;
                await this.repository.setActiveTabId(newActiveTabId);
            }

            await this.repository.deleteTab(tabId);

            const result = {
                closedTab,
                newActiveTabId
            };

            this._notifyListeners('tab-closed', result);
            return result;
        } catch (error) {
            this.statusDisplay?.updateStatus('Error closing tab', null);
            throw error;
        }
    }

    /**
     * Updates tab data
     *
     * @async
     * @param {string} tabId - The tab ID
     * @param {Object} updates - Updates to apply
     * @returns {Promise<Object|null>} Updated tab or null if not found
     * @throws {Error} If update fails
     * @fires WorkspaceTabService#tab-updated
     */
    async updateTab(tabId, updates) {
        const updatedTab = await this.repository.updateTab(tabId, updates);
        if (updatedTab) {
            this._notifyListeners('tab-updated', updatedTab);
        }
        return updatedTab;
    }

    /**
     * Renames a tab
     *
     * @async
     * @param {string} tabId - The tab ID
     * @param {string} newName - New name for tab
     * @returns {Promise<Object|null>} Updated tab or null if not found
     * @throws {Error} If rename fails
     * @fires WorkspaceTabService#tab-renamed
     */
    async renameTab(tabId, newName) {
        try {
            const updatedTab = await this.repository.updateTab(tabId, { name: newName });
            if (updatedTab) {
                this._notifyListeners('tab-renamed', updatedTab);
            }
            return updatedTab;
        } catch (error) {
            this.statusDisplay?.updateStatus('Error renaming tab', null);
            throw error;
        }
    }

    /**
     * Duplicates a tab
     *
     * Creates a copy with "(Copy)" appended to name.
     *
     * @async
     * @param {string} tabId - The tab ID to duplicate
     * @returns {Promise<Object|null>} Duplicated tab or null if source not found
     * @throws {Error} If duplication fails
     * @fires WorkspaceTabService#tab-duplicated
     */
    async duplicateTab(tabId) {
        try {
            const tab = await this.repository.getTabById(tabId);
            if (!tab) {
                return null;
            }

            const duplicatedTab = {
                ...tab,
                id: undefined, // Let repository generate new ID
                name: `${tab.name} (Copy)`,
                createdAt: undefined,
                lastModifiedAt: undefined
            };

            const newTab = await this.repository.addTab(duplicatedTab);
            this._notifyListeners('tab-duplicated', newTab);
            return newTab;
        } catch (error) {
            this.statusDisplay?.updateStatus('Error duplicating tab', null);
            throw error;
        }
    }

    /**
     * Marks tab as modified or unmodified
     *
     * Used to indicate unsaved changes.
     *
     * @async
     * @param {string} tabId - The tab ID
     * @param {boolean} isModified - Whether tab has unsaved changes
     * @returns {Promise<void>}
     */
    async setTabModified(tabId, isModified) {
        await this.updateTab(tabId, { isModified });
    }

    /**
     * Generates a tab name from request details
     *
     * Extracts endpoint from URL path for display.
     *
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @returns {string} Generated tab name like "GET /users"
     */
    generateTabName(method, url) {
        if (!url) {return 'New Request';}

        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;
            const segments = path.split('/').filter(s => s);
            const endpoint = segments.length > 0 ? `/${segments[segments.length - 1]}` : '/';
            return `${method} ${endpoint}`;
        } catch {
            return `${method} Request`;
        }
    }

    /**
     * Adds a change listener
     *
     * Listener receives event type and data.
     *
     * @param {Function} listener - The callback function
     * @param {string} listener.event - Event type
     * @param {*} listener.data - Event data
     * @returns {void}
     */
    addListener(listener) {
        this.listeners.push(listener);
    }

    /**
     * Removes a change listener
     *
     * @param {Function} listener - The callback function to remove
     * @returns {void}
     */
    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    /**
     * Notifies all listeners of a change
     *
     * Catches and logs listener errors to prevent disruption.
     *
     * @private
     * @param {string} event - Event type
     * @param {*} data - Event data
     * @returns {void}
     */
    _notifyListeners(event, data) {
        this.listeners.forEach(listener => {
            try {
                listener(event, data);
            } catch (error) {
                void error;
            }
        });
    }

    /**
     * Clears all tabs
     *
     * WARNING: This removes all tabs from storage.
     *
     * @async
     * @returns {Promise<void>}
     * @fires WorkspaceTabService#tabs-cleared
     */
    async clearAllTabs() {
        await this.repository.clearAllTabs();
        this._notifyListeners('tabs-cleared', null);
    }
}
