/**
 * @fileoverview Service for workspace tab management business logic
 * @module services/WorkspaceTabService
 */

import logger from '../logger.js';

const log = logger.scope('WorkspaceTabService');

export class WorkspaceTabService {
    /**
     * @param {WorkspaceTabRepository} repository
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(repository, statusDisplay) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
    }

    /**
     * @param {string} label
     * @param {function(): Promise<*>} work
     * @returns {Promise<*>}
     */
    async _reporting(label, work) {
        try {
            return await work();
        } catch (error) {
            this.statusDisplay?.update(label, null);
            throw error;
        }
    }

    /** @returns {Promise<Object>} */
    async initialize() {
        return this._reporting('Error initializing workspace tabs', async () => {
            const tabs = await this.repository.getTabs();
            let activeTabId = await this.repository.getActiveTabId();

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
        });
    }

    /** @returns {Promise<Array<Object>>} */
    async getAllTabs() {
        return this.repository.getTabs();
    }

    /** @returns {Promise<Object|null>} */
    async getActiveTab() {
        const activeTabId = await this.repository.getActiveTabId();
        if (!activeTabId) {return null;}
        return this.repository.getTabById(activeTabId);
    }

    /** @returns {Promise<string|null>} */
    async getActiveTabId() {
        return this.repository.getActiveTabId();
    }

    /**
     * @param {Object} [options={}]
     * @param {string} [options.name]
     * @param {Object} [options.requestData]
     * @returns {Promise<Object>}
     */
    async createTab(options = {}) {
        return this._reporting('Error creating tab', () => this.repository.addTab(options));
    }

    /**
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async switchTab(tabId) {
        return this._reporting('Error switching tab', async () => {
            const tab = await this.repository.getTabById(tabId);
            if (!tab) {
                log.warn('Tab not found', { tabId });
                return null;
            }

            await this.repository.setActiveTabId(tabId);
            return tab;
        });
    }

    /**
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async closeTab(tabId) {
        return this._reporting('Error closing tab', async () => {
            const tabs = await this.repository.getTabs();
            const tabIndex = tabs.findIndex(t => t.id === tabId);

            if (tabIndex === -1) {
                return null;
            }

            if (tabs.length === 1) {
                this.statusDisplay?.update('Cannot close the last tab', null);
                return null;
            }

            const closedTab = tabs[tabIndex];
            const activeTabId = await this.repository.getActiveTabId();

            let newActiveTabId = activeTabId;
            if (tabId === activeTabId) {
                const newIndex = tabIndex < tabs.length - 1 ? tabIndex + 1 : tabIndex - 1;
                newActiveTabId = tabs[newIndex].id;
                await this.repository.setActiveTabId(newActiveTabId);
            }

            await this.repository.deleteTab(tabId);

            return {
                closedTab,
                newActiveTabId
            };
        });
    }

    /**
     * @param {Array<string>} tabIds
     * @returns {Promise<{closedTabs: Array<Object>, newActiveTabId: string}|null>}
     */
    async closeTabs(tabIds) {
        return this._reporting('Error closing tab', async () => {
            const ids = new Set(tabIds);
            const tabs = await this.repository.getTabs();
            const closedTabs = tabs.filter(t => ids.has(t.id));
            if (closedTabs.length === 0 || closedTabs.length === tabs.length) {
                return null;
            }

            const activeTabId = await this.repository.getActiveTabId();
            let newActiveTabId = activeTabId;
            if (ids.has(activeTabId)) {
                const activeIndex = tabs.findIndex(t => t.id === activeTabId);
                const successor = tabs.slice(activeIndex + 1).find(t => !ids.has(t.id)) ??
                    tabs.slice(0, activeIndex).reverse().find(t => !ids.has(t.id));
                newActiveTabId = successor.id;
                await this.repository.setActiveTabId(newActiveTabId);
            }

            await this.repository.deleteTabs([...ids]);

            return { closedTabs, newActiveTabId };
        });
    }

    /**
     * @param {string} tabId
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async updateTab(tabId, updates) {
        return this.repository.updateTab(tabId, updates);
    }

    /**
     * @param {string} tabId
     * @param {string} newName
     * @returns {Promise<Object|null>}
     */
    async renameTab(tabId, newName) {
        return this._reporting('Error renaming tab', () => this.repository.updateTab(tabId, { name: newName }));
    }

    /**
     * @param {string} tabId
     * @returns {Promise<Object|null>}
     */
    async duplicateTab(tabId) {
        return this._reporting('Error duplicating tab', async () => {
            const tab = await this.repository.getTabById(tabId);
            if (!tab) {
                return null;
            }

            const duplicatedTab = {
                ...tab,
                id: undefined,
                name: `${tab.name} (Copy)`,
                createdAt: undefined,
                lastModifiedAt: undefined
            };

            return this.repository.addTab(duplicatedTab);
        });
    }

    /**
     * @param {string} tabId
     * @param {boolean} isModified
     * @returns {Promise<void>}
     */
    async setTabModified(tabId, isModified) {
        await this.updateTab(tabId, { isModified });
    }

    /**
     * @param {Array<string>} orderedTabIds
     * @returns {Promise<void>}
     */
    async reorderTabs(orderedTabIds) {
        await this.repository.reorderTabs(orderedTabIds);
    }

    /**
     * @param {string} method
     * @param {string} url
     * @returns {string}
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
}
