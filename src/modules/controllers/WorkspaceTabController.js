/**
 * WorkspaceTabController
 *
 * Coordinates workspace tabs between UI, service, and application state.
 * Manages tab lifecycle and state synchronization.
 */
export class WorkspaceTabController {
    constructor(service, tabBar, stateManager, responseContainerManager) {
        this.service = service;
        this.tabBar = tabBar;
        this.stateManager = stateManager;
        this.responseContainerManager = responseContainerManager;

        // Bind tab bar event handlers
        this.tabBar.onTabSwitch = (tabId) => this.switchTab(tabId);
        this.tabBar.onTabClose = (tabId) => this.closeTab(tabId);
        this.tabBar.onTabCreate = () => this.createNewTab();
        this.tabBar.onTabRename = (tabId, newName) => this.renameTab(tabId, newName);
        this.tabBar.onTabDuplicate = (tabId) => this.duplicateTab(tabId);
        this.tabBar.onCloseOthers = (tabId) => this.closeOtherTabs(tabId);

        // Listen to service changes
        this.service.addListener((event, data) => this._handleServiceEvent(event, data));
    }

    /**
     * Initialize the controller and load tabs
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const { tabs, activeTabId } = await this.service.initialize();

            // Render tab bar
            this.tabBar.render(tabs, activeTabId);

            // Show response container for active tab
            if (activeTabId) {
                this.responseContainerManager.showContainer(activeTabId);

                // Restore active tab state to UI
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    await this.stateManager.restoreTabState(activeTab);
                }
            }
        } catch (error) {
            console.error('Error initializing workspace tabs:', error);
        }
    }

    /**
     * Create a new tab
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    async createNewTab(options = {}) {
        try {
            // Save current tab state before creating new one
            await this._saveCurrentTabState();

            const newTab = await this.service.createTab(options);
            await this.service.switchTab(newTab.id);

            // Show response container for new tab
            this.responseContainerManager.showContainer(newTab.id);

            // Re-render tab bar
            const tabs = await this.service.getAllTabs();
            const activeTabId = await this.service.getActiveTabId();
            this.tabBar.render(tabs, activeTabId);

            // Clear UI for new tab
            await this.stateManager.restoreTabState(newTab);

            return newTab;
        } catch (error) {
            console.error('Error creating new tab:', error);
            throw error;
        }
    }

    /**
     * Switch to a different tab
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async switchTab(tabId) {
        try {
            const currentTabId = await this.service.getActiveTabId();

            if (currentTabId === tabId) {
                return; // Already on this tab
            }

            // Save current tab state
            await this._saveCurrentTabState();

            // Switch tab in service
            const tab = await this.service.switchTab(tabId);
            if (!tab) {
                console.error('Tab not found:', tabId);
                return;
            }

            // Show response container for this workspace tab
            this.responseContainerManager.showContainer(tabId);

            // Update UI
            this.tabBar.setActiveTab(tabId);
            await this.stateManager.restoreTabState(tab);
        } catch (error) {
            console.error('Error switching tab:', error);
        }
    }

    /**
     * Close a tab
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async closeTab(tabId) {
        try {
            const result = await this.service.closeTab(tabId);
            if (!result) {
                return; // Could not close (last tab or not found)
            }

            // Remove response container for closed tab
            this.responseContainerManager.removeContainer(tabId);

            // Re-render tab bar
            const tabs = await this.service.getAllTabs();
            this.tabBar.render(tabs, result.newActiveTabId);

            // If we switched to a different tab, show its container and restore state
            if (result.newActiveTabId !== tabId) {
                this.responseContainerManager.showContainer(result.newActiveTabId);

                const newActiveTab = tabs.find(t => t.id === result.newActiveTabId);
                if (newActiveTab) {
                    await this.stateManager.restoreTabState(newActiveTab);
                }
            }
        } catch (error) {
            console.error('Error closing tab:', error);
        }
    }

    /**
     * Rename a tab
     * @param {string} tabId
     * @param {string} newName
     * @returns {Promise<void>}
     */
    async renameTab(tabId, newName) {
        try {
            await this.service.renameTab(tabId, newName);
            this.tabBar.updateTab(tabId, { name: newName });
        } catch (error) {
            console.error('Error renaming tab:', error);
        }
    }

    /**
     * Duplicate a tab
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async duplicateTab(tabId) {
        try {
            const newTab = await this.service.duplicateTab(tabId);
            if (newTab) {
                // Re-render tab bar to show new tab
                const tabs = await this.service.getAllTabs();
                const activeTabId = await this.service.getActiveTabId();
                this.tabBar.render(tabs, activeTabId);
            }
        } catch (error) {
            console.error('Error duplicating tab:', error);
        }
    }

    /**
     * Close all tabs except the specified one
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async closeOtherTabs(tabId) {
        try {
            const tabs = await this.service.getAllTabs();
            const tabsToClose = tabs.filter(t => t.id !== tabId);

            for (const tab of tabsToClose) {
                await this.service.closeTab(tab.id);
            }

            // Switch to the remaining tab if not already active
            await this.service.switchTab(tabId);

            // Re-render tab bar
            const remainingTabs = await this.service.getAllTabs();
            this.tabBar.render(remainingTabs, tabId);

            // Restore tab state
            const activeTab = remainingTabs.find(t => t.id === tabId);
            if (activeTab) {
                await this.stateManager.restoreTabState(activeTab);
            }
        } catch (error) {
            console.error('Error closing other tabs:', error);
        }
    }

    /**
     * Mark the current tab as modified
     * @returns {Promise<void>}
     */
    async markCurrentTabModified() {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (activeTabId) {
                await this.service.setTabModified(activeTabId, true);
                this.tabBar.updateTab(activeTabId, { isModified: true });
            }
        } catch (error) {
            console.error('Error marking tab as modified:', error);
        }
    }

    /**
     * Mark the current tab as unmodified
     * @returns {Promise<void>}
     */
    async markCurrentTabUnmodified() {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (activeTabId) {
                await this.service.setTabModified(activeTabId, false);
                this.tabBar.updateTab(activeTabId, { isModified: false });
            }
        } catch (error) {
            console.error('Error marking tab as unmodified:', error);
        }
    }

    /**
     * Update the current tab's name based on request
     * @param {string} method
     * @param {string} url
     * @returns {Promise<void>}
     */
    async updateCurrentTabName(method, url) {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (!activeTabId) return;

            const activeTab = await this.service.getActiveTab();
            if (!activeTab) return;

            // Don't auto-rename if user has customized the name
            if (activeTab.name !== 'New Request' && !activeTab.name.match(/^(GET|POST|PUT|DELETE|PATCH)/)) {
                return;
            }

            const newName = this.service.generateTabName(method, url);
            await this.service.updateTab(activeTabId, { name: newName });
            this.tabBar.updateTab(activeTabId, { name: newName });
        } catch (error) {
            console.error('Error updating tab name:', error);
        }
    }

    /**
     * Load an endpoint from a collection into the current or new tab
     * @param {Object} endpoint
     * @param {boolean} inNewTab
     * @returns {Promise<void>}
     */
    async loadEndpoint(endpoint, inNewTab = false) {
        try {
            let targetTabId;

            if (inNewTab) {
                const newTab = await this.createNewTab();
                targetTabId = newTab.id;
            } else {
                await this._saveCurrentTabState();
                targetTabId = await this.service.getActiveTabId();
            }

            // Construct URL with {{baseUrl}} if collection has a baseUrl
            let fullUrl = endpoint.path;
            if (endpoint.collectionBaseUrl) {
                fullUrl = '{{baseUrl}}' + endpoint.path;
            }

            // Replace path parameters with {{paramName}} format
            if (endpoint.parameters?.path) {
                Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                    fullUrl = fullUrl.replace(`{${key}}`, `{{${key}}}`);
                });
            }

            // Load path parameters (prioritize persisted over defaults)
            const pathParams = {};
            if (endpoint.persistedPathParams && endpoint.persistedPathParams.length > 0) {
                // Use persisted path params
                endpoint.persistedPathParams.forEach(param => {
                    pathParams[param.key] = param.value;
                });
            } else if (endpoint.parameters?.path) {
                // Use defaults from OpenAPI spec
                Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                    pathParams[key] = param.example || '';
                });
            }

            // Load query parameters (prioritize persisted over defaults)
            const queryParams = {};
            if (endpoint.persistedQueryParams && endpoint.persistedQueryParams.length > 0) {
                // Use persisted query params
                endpoint.persistedQueryParams.forEach(param => {
                    queryParams[param.key] = param.value;
                });
            } else if (endpoint.parameters?.query) {
                // Use defaults from OpenAPI spec
                Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
                    queryParams[key] = param.example || '';
                });
            }

            // Load headers (prioritize persisted over defaults)
            const headers = {};
            if (endpoint.persistedHeaders && endpoint.persistedHeaders.length > 0) {
                // Use persisted headers
                endpoint.persistedHeaders.forEach(header => {
                    headers[header.key] = header.value;
                });
            } else {
                // Use defaults from collection and OpenAPI spec
                if (endpoint.collectionDefaultHeaders) {
                    Object.entries(endpoint.collectionDefaultHeaders).forEach(([key, value]) => {
                        headers[key] = value;
                    });
                }

                if (endpoint.parameters?.header) {
                    Object.entries(endpoint.parameters.header).forEach(([key, param]) => {
                        headers[key] = param.example || '';
                    });
                }

                // Add Content-Type for POST/PUT/PATCH if not already present
                if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && !headers['Content-Type']) {
                    headers['Content-Type'] = endpoint.requestBody?.contentType || 'application/json';
                }
            }

            // Load request body (prioritize persisted over generated)
            let bodyString = '';
            if (endpoint.persistedBody) {
                // Use persisted body
                bodyString = endpoint.persistedBody;
            } else if (endpoint.requestBodyString) {
                // Use the properly generated body string passed from CollectionController
                bodyString = endpoint.requestBodyString;
            } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
                bodyString = JSON.stringify({ "data": "example" }, null, 2);
            }

            // Load auth configuration (prioritize persisted config over OpenAPI spec)
            let authType = 'none';
            let authConfig = {};

            if (endpoint.persistedAuthConfig) {
                // Use persisted auth config if available (user's saved auth)
                // persistedAuthConfig has structure: { type: 'bearer', config: {...} }
                authType = endpoint.persistedAuthConfig.type || 'none';
                authConfig = endpoint.persistedAuthConfig.config || {};
            } else if (endpoint.security) {
                // Fall back to endpoint.security from OpenAPI spec
                // Both persistedAuthConfig and endpoint.security have the same structure: { type, config }
                authType = endpoint.security.type || 'none';
                authConfig = endpoint.security.config || {};
            }

            // Update tab with endpoint data
            // Use endpoint.name if available (contains OpenAPI summary/operationId),
            // otherwise generate from method and path
            const tabName = endpoint.name || this.service.generateTabName(endpoint.method, endpoint.path);
            await this.service.updateTab(targetTabId, {
                name: tabName,
                endpoint: {
                    collectionId: endpoint.collectionId,
                    endpointId: endpoint.id
                },
                request: {
                    url: fullUrl,
                    method: endpoint.method,
                    pathParams: pathParams,
                    queryParams: queryParams,
                    headers: headers,
                    body: bodyString,
                    authType: authType,
                    authConfig: authConfig
                },
                isModified: false
            });

            // Restore state to UI
            const tab = await this.service.getActiveTab();
            if (tab) {
                await this.stateManager.restoreTabState(tab);
                this.tabBar.updateTab(targetTabId, { name: tabName, isModified: false });
            }
        } catch (error) {
            console.error('Error loading endpoint:', error);
        }
    }

    /**
     * Save current tab state from UI
     * @private
     */
    async _saveCurrentTabState() {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (!activeTabId) {
                return;
            }

            const currentState = await this.stateManager.captureCurrentState();
            await this.service.updateTab(activeTabId, currentState);
        } catch (error) {
            console.error('Error saving current tab state:', error);
        }
    }

    /**
     * Handle service events
     * @private
     */
    _handleServiceEvent(event, data) {
        // Can be extended to handle various service events
        // For now, most updates are handled directly in methods
    }

    /**
     * Get active tab
     * @returns {Promise<Object|null>}
     */
    async getActiveTab() {
        return await this.service.getActiveTab();
    }
}
