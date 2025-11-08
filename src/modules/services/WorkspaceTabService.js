/**
 * WorkspaceTabService
 *
 * Business logic for workspace tab management.
 * Coordinates between repository and controller layers.
 */
export class WorkspaceTabService {
    constructor(repository, statusDisplay) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.listeners = [];
    }

    /**
     * Initialize the tab service
     * @returns {Promise<Object>}
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
            console.error('Error initializing workspace tabs:', error);
            this.statusDisplay?.updateStatus('Error initializing workspace tabs', null);
            throw error;
        }
    }

    /**
     * Get all tabs
     * @returns {Promise<Array>}
     */
    async getAllTabs() {
        return await this.repository.getTabs();
    }

    /**
     * Get active tab
     * @returns {Promise<Object|null>}
     */
    async getActiveTab() {
        const activeTabId = await this.repository.getActiveTabId();
        if (!activeTabId) return null;
        return await this.repository.getTabById(activeTabId);
    }

    /**
     * Get active tab ID
     * @returns {Promise<string|null>}
     */
    async getActiveTabId() {
        return await this.repository.getActiveTabId();
    }

    /**
     * Create a new tab
     * @param {Object} options - Tab creation options
     * @returns {Promise<Object>}
     */
    async createTab(options = {}) {
        try {
            const newTab = await this.repository.addTab(options);
            this._notifyListeners('tab-created', newTab);
            return newTab;
        } catch (error) {
            console.error('Error creating tab:', error);
            this.statusDisplay?.updateStatus('Error creating tab', null);
            throw error;
        }
    }

    /**
     * Switch to a different tab
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async switchTab(tabId) {
        try {
            const tab = await this.repository.getTabById(tabId);
            if (!tab) {
                console.warn('Tab not found:', tabId);
                return null;
            }

            console.log(`[WorkspaceTabService] Switching to tab ${tabId}, response timings:`, tab.response?.timings);

            await this.repository.setActiveTabId(tabId);
            this._notifyListeners('tab-switched', tab);
            return tab;
        } catch (error) {
            console.error('Error switching tab:', error);
            this.statusDisplay?.updateStatus('Error switching tab', null);
            throw error;
        }
    }

    /**
     * Close a tab
     * @param {string} tabId
     * @returns {Promise<Object>} Returns info about the closed tab and new active tab
     */
    async closeTab(tabId) {
        try {
            const tabs = await this.repository.getTabs();
            const tabIndex = tabs.findIndex(t => t.id === tabId);

            if (tabIndex === -1) {
                console.warn('Tab not found:', tabId);
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
            console.error('Error closing tab:', error);
            this.statusDisplay?.updateStatus('Error closing tab', null);
            throw error;
        }
    }

    /**
     * Update tab data
     * @param {string} tabId
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async updateTab(tabId, updates) {
        try {
            const updatedTab = await this.repository.updateTab(tabId, updates);
            if (updatedTab) {
                this._notifyListeners('tab-updated', updatedTab);
            }
            return updatedTab;
        } catch (error) {
            console.error('Error updating tab:', error);
            throw error;
        }
    }

    /**
     * Rename a tab
     * @param {string} tabId
     * @param {string} newName
     * @returns {Promise<Object|null>}
     */
    async renameTab(tabId, newName) {
        try {
            const updatedTab = await this.repository.updateTab(tabId, { name: newName });
            if (updatedTab) {
                this._notifyListeners('tab-renamed', updatedTab);
            }
            return updatedTab;
        } catch (error) {
            console.error('Error renaming tab:', error);
            this.statusDisplay?.updateStatus('Error renaming tab', null);
            throw error;
        }
    }

    /**
     * Duplicate a tab
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async duplicateTab(tabId) {
        try {
            const tab = await this.repository.getTabById(tabId);
            if (!tab) {
                console.warn('Tab not found:', tabId);
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
            console.error('Error duplicating tab:', error);
            this.statusDisplay?.updateStatus('Error duplicating tab', null);
            throw error;
        }
    }

    /**
     * Mark tab as modified (has unsaved changes)
     * @param {string} tabId
     * @param {boolean} isModified
     * @returns {Promise<void>}
     */
    async setTabModified(tabId, isModified) {
        await this.updateTab(tabId, { isModified });
    }

    /**
     * Generate a tab name from request details
     * @param {string} method
     * @param {string} url
     * @returns {string}
     */
    generateTabName(method, url) {
        if (!url) return 'New Request';

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
     * Add a change listener
     * @param {Function} listener
     */
    addListener(listener) {
        this.listeners.push(listener);
    }

    /**
     * Remove a change listener
     * @param {Function} listener
     */
    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    /**
     * Notify all listeners of a change
     * @private
     */
    _notifyListeners(event, data) {
        this.listeners.forEach(listener => {
            try {
                listener(event, data);
            } catch (error) {
                console.error('Error in tab listener:', error);
            }
        });
    }

    /**
     * Clear all tabs
     * @returns {Promise<void>}
     */
    async clearAllTabs() {
        await this.repository.clearAllTabs();
        this._notifyListeners('tabs-cleared', null);
    }
}
