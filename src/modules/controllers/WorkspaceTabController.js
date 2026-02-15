/**
 * @fileoverview Controller for coordinating workspace tab operations between UI and services
 * @module controllers/WorkspaceTabController
 */

/**
 * Controller for coordinating workspace tab operations between UI and services
 *
 * @class
 * @classdesc Mediates between workspace tab UI components (TabBar), service layer,
 * and state management. Handles tab lifecycle operations including creation, switching,
 * closing, renaming, and duplication. Manages synchronization between tab state
 * and form UI, and coordinates with response container visibility.
 */
export class WorkspaceTabController {
    /**
     * Creates a WorkspaceTabController instance
     *
     * @param {WorkspaceTabService} service - The workspace tab service for business logic
     * @param {WorkspaceTabBar} tabBar - The tab bar UI component
     * @param {WorkspaceTabStateManager} stateManager - State manager for capturing and restoring tab state
     * @param {ResponseContainerManager} responseContainerManager - Manager for response container visibility
     */
    constructor(service, tabBar, stateManager, responseContainerManager) {
        this.service = service;
        this.tabBar = tabBar;
        this.stateManager = stateManager;
        this.responseContainerManager = responseContainerManager;
        this.isRestoringState = false; // Flag to prevent marking tabs as modified during restoration

        // Runner controllers map (tabId -> RunnerController)
        this.runnerControllers = new Map();

        // Bind tab bar event handlers
        this.tabBar.onTabSwitch = (tabId) => this.switchTab(tabId);
        this.tabBar.onTabClose = (tabId) => this.closeTab(tabId);
        this.tabBar.onTabCreate = () => this.createNewTab();
        this.tabBar.onTabRename = (tabId, newName) => this.renameTab(tabId, newName);
        this.tabBar.onTabDuplicate = (tabId) => this.duplicateTab(tabId);
        this.tabBar.onCloseOthers = (tabId) => this.closeOtherTabs(tabId);
        this.tabBar.onRunnerTabCreate = () => this.createRunnerTab();

        // Listen to service changes
        this.service.addListener((event, data) => this._handleServiceEvent(event, data));
    }

    /**
     * Initializes the controller and loads existing tabs
     *
     * Loads tabs from service, renders tab bar, shows response container for active tab,
     * and restores active tab state to the UI.
     *
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const { tabs, activeTabId } = await this.service.initialize();

            // Render tab bar
            this.tabBar.render(tabs, activeTabId);

            // Restore active tab state to UI
            if (activeTabId) {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    // Update UI based on tab type (runner vs request)
                    this._updateUIForTabType(activeTab);

                    if (activeTab.type === 'runner') {
                        // Initialize runner tab
                        await this._initializeRunnerTab(activeTabId);
                    } else {
                        // Show response container for request tab
                        this.responseContainerManager.showContainer(activeTabId);
                        await this.stateManager.restoreTabState(activeTab);
                    }
                }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Creates a new tab
     *
     * Saves current tab state before creating new one, creates tab via service,
     * switches to the new tab, and updates UI.
     *
     * @async
     * @param {Object} [options={}] - Tab creation options
     * @param {string} [options.name] - Initial tab name
     * @returns {Promise<Object>} The newly created tab object
     * @throws {Error} If tab creation fails
     */
    async createNewTab(options = {}) {
        try {
            // Save current tab state before creating new one
            await this._saveCurrentTabState();

            const newTab = await this.service.createTab(options);
            await this.service.switchTab(newTab.id);

            // Update UI based on tab type (switch from runner to request UI if needed)
            this._updateUIForTabType(newTab);

            // Show response container for new tab
            this.responseContainerManager.showContainer(newTab.id);

            // Re-render tab bar
            const tabs = await this.service.getAllTabs();
            const activeTabId = await this.service.getActiveTabId();
            this.tabBar.render(tabs, activeTabId);

            // Clear UI for new tab
            this.isRestoringState = true;
            await this.stateManager.restoreTabState(newTab);
            this.isRestoringState = false;

            // Clear scripts for new tab (no endpoint selected)
            if (window.scriptController) {
                window.scriptController.clearScripts();
            }

            return newTab;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    /**
     * Creates a new runner tab
     *
     * Creates a special tab type for the Collection Runner feature.
     * Runner tabs have their own UI and don't use the standard request form.
     *
     * @async
     * @returns {Promise<Object>} The newly created runner tab object
     */
    async createRunnerTab() {
        try {
            // Save current tab state before creating new one
            await this._saveCurrentTabState();

            const newTab = await this.service.createTab({
                name: 'Collection Runner',
                type: 'runner'
            });
            await this.service.switchTab(newTab.id);

            // Re-render tab bar
            const tabs = await this.service.getAllTabs();
            const activeTabId = await this.service.getActiveTabId();
            this.tabBar.render(tabs, activeTabId);

            // Hide other runner containers before initializing the new one
            this._updateUIForTabType(newTab);

            // Initialize runner UI in the main content area
            await this._initializeRunnerTab(newTab.id);

            return newTab;
        } catch (error) {
            console.error('Error creating runner tab:', error);
            throw error;
        }
    }

    /**
     * Initializes the runner tab UI
     *
     * @private
     * @async
     * @param {string} tabId - The runner tab ID
     */
    async _initializeRunnerTab(tabId) {
        // Import RunnerController dynamically to avoid circular dependencies
        const { RunnerController } = await import('./RunnerController.js');
        const { loadCollections } = await import('../collectionManager.js');

        // Create a container for the runner panel
        const mainContentArea = document.getElementById('main-content-area');
        if (!mainContentArea) {return;}

        // Hide the standard request builder UI
        const requestBuilder = mainContentArea.querySelector('.request-builder');
        const requestConfig = mainContentArea.querySelector('.request-config');
        const resizerHandle = mainContentArea.querySelector('.resizer-handle');
        const responseArea = mainContentArea.querySelector('.response-area');

        if (requestBuilder) {requestBuilder.classList.add('is-hidden');}
        if (requestConfig) {requestConfig.classList.add('is-hidden');}
        if (resizerHandle) {resizerHandle.classList.add('is-hidden');}
        if (responseArea) {responseArea.classList.add('is-hidden');}

        // Create runner container
        let runnerContainer = document.getElementById(`runner-container-${tabId}`);
        if (!runnerContainer) {
            runnerContainer = document.createElement('div');
            runnerContainer.id = `runner-container-${tabId}`;
            runnerContainer.className = 'runner-container';
            runnerContainer.style.flex = '1';
            runnerContainer.style.display = 'flex';
            runnerContainer.style.flexDirection = 'column';
            runnerContainer.style.overflow = 'hidden';

            // Insert after workspace tab bar
            const tabBarContainer = document.getElementById('workspace-tab-bar-container');
            if (tabBarContainer && tabBarContainer.nextSibling) {
                mainContentArea.insertBefore(runnerContainer, tabBarContainer.nextSibling);
            } else {
                mainContentArea.appendChild(runnerContainer);
            }
        }

        // Initialize runner controller
        const runnerController = new RunnerController(
            window.backendAPI,
            async () => loadCollections()
        );

        await runnerController.initialize(runnerContainer);
        this.runnerControllers.set(tabId, runnerController);
    }

    /**
     * Cleans up runner tab resources
     *
     * @private
     * @param {string} tabId - The runner tab ID
     */
    _cleanupRunnerTab(tabId) {
        // Remove runner container
        const runnerContainer = document.getElementById(`runner-container-${tabId}`);
        if (runnerContainer) {
            runnerContainer.remove();
        }

        // Remove controller reference
        this.runnerControllers.delete(tabId);
    }

    /**
     * Shows or hides runner/request UI based on tab type
     *
     * @private
     * @param {Object} tab - The tab object
     */
    _updateUIForTabType(tab) {
        const mainContentArea = document.getElementById('main-content-area');
        if (!mainContentArea) {return;}

        const requestBuilder = mainContentArea.querySelector('.request-builder');
        const requestConfig = mainContentArea.querySelector('.request-config');
        const resizerHandle = mainContentArea.querySelector('.resizer-handle');
        const responseArea = mainContentArea.querySelector('.response-area');

        // Hide all runner containers first
        const runnerContainers = mainContentArea.querySelectorAll('[id^="runner-container-"]');
        runnerContainers.forEach(c => c.classList.add('is-hidden'));

        if (tab.type === 'runner') {
            // Show runner UI, hide request UI
            if (requestBuilder) {requestBuilder.classList.add('is-hidden');}
            if (requestConfig) {requestConfig.classList.add('is-hidden');}
            if (resizerHandle) {resizerHandle.classList.add('is-hidden');}
            if (responseArea) {responseArea.classList.add('is-hidden');}

            const runnerContainer = document.getElementById(`runner-container-${tab.id}`);
            if (runnerContainer) {
                runnerContainer.classList.remove('is-hidden');
            }
        } else {
            // Show request UI, hide runner UI
            if (requestBuilder) {requestBuilder.classList.remove('is-hidden');}
            if (requestConfig) {requestConfig.classList.remove('is-hidden');}
            if (resizerHandle) {resizerHandle.classList.remove('is-hidden');}
            if (responseArea) {responseArea.classList.remove('is-hidden');}
        }
    }

    /**
     * Switches to a different tab
     *
     * Saves current tab state before switching, switches via service,
     * shows response container for new tab, and restores new tab state to UI.
     *
     * @async
     * @param {string} tabId - The ID of the tab to switch to
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
                return;
            }

            // Update UI based on tab type (runner vs request)
            this._updateUIForTabType(tab);

            // Show response container for this workspace tab (only for request tabs)
            if (tab.type !== 'runner') {
                this.responseContainerManager.showContainer(tabId);
            }

            // Update UI
            this.tabBar.setActiveTab(tabId);

            // Handle runner tabs differently
            if (tab.type === 'runner') {
                // Initialize runner if not already done
                if (!this.runnerControllers.has(tabId)) {
                    await this._initializeRunnerTab(tabId);
                }
                return;
            }

            // Set flag to prevent marking tab as modified during restoration
            this.isRestoringState = true;
            await this.stateManager.restoreTabState(tab);
            this.isRestoringState = false;

            // Load scripts for this tab's endpoint, or clear if no endpoint
            if (window.scriptController) {
                if (tab.endpoint && tab.endpoint.collectionId && tab.endpoint.endpointId) {
                    await window.scriptController.loadScriptsForEndpoint(
                        tab.endpoint.collectionId,
                        tab.endpoint.endpointId
                    );
                } else {
                    window.scriptController.clearScripts();
                }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Closes a tab
     *
     * Closes tab via service, removes response container, re-renders tab bar,
     * and restores state of newly active tab if different.
     * Cannot close the last remaining tab.
     *
     * @async
     * @param {string} tabId - The ID of the tab to close
     * @returns {Promise<void>}
     */
    async closeTab(tabId) {
        try {
            // Check if this is a runner tab and clean up
            if (this.runnerControllers.has(tabId)) {
                this._cleanupRunnerTab(tabId);
            }

            const result = await this.service.closeTab(tabId);
            if (!result) {
                return; // Could not close (last tab or not found)
            }

            // Remove response container for closed tab
            this.responseContainerManager.removeContainer(tabId);

            // Re-render tab bar
            const tabs = await this.service.getAllTabs();
            this.tabBar.render(tabs, result.newActiveTabId);

            // If we switched to a different tab, activate it
            if (result.newActiveTabId !== tabId) {
                const newActiveTab = tabs.find(t => t.id === result.newActiveTabId);
                if (newActiveTab) {
                    await this._activateTab(newActiveTab);
                }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Activates a tab and restores its state
     *
     * @private
     * @async
     * @param {Object} tab - The tab to activate
     */
    async _activateTab(tab) {
        this._updateUIForTabType(tab);

        if (tab.type === 'runner') {
            if (!this.runnerControllers.has(tab.id)) {
                await this._initializeRunnerTab(tab.id);
            }
        } else {
            this.responseContainerManager.showContainer(tab.id);
            this.isRestoringState = true;
            await this.stateManager.restoreTabState(tab);
            this.isRestoringState = false;
        }
    }

    /**
     * Renames a tab
     *
     * @async
     * @param {string} tabId - The ID of the tab to rename
     * @param {string} newName - The new name for the tab
     * @returns {Promise<void>}
     */
    async renameTab(tabId, newName) {
        try {
            await this.service.renameTab(tabId, newName);
            this.tabBar.updateTab(tabId, { name: newName });
        } catch (error) {
            void error;
        }
    }

    /**
     * Duplicates a tab
     *
     * Creates a copy of the tab with all its state and content.
     *
     * @async
     * @param {string} tabId - The ID of the tab to duplicate
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
            void error;
        }
    }

    /**
     * Closes all tabs except the specified one
     *
     * @async
     * @param {string} tabId - The ID of the tab to keep open
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
                this.isRestoringState = true;
                await this.stateManager.restoreTabState(activeTab);
                this.isRestoringState = false;
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Marks the current tab as modified
     *
     * Indicates unsaved changes in the tab with a visual indicator.
     *
     * @async
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
            void error;
        }
    }

    /**
     * Marks the current tab as unmodified
     *
     * Removes the unsaved changes indicator from the tab.
     *
     * @async
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
            void error;
        }
    }

    /**
     * Updates the current tab's name based on request method and URL
     *
     * Automatically generates a meaningful tab name unless user has customized it.
     * Only updates if current name is default or follows standard method pattern.
     *
     * @async
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} url - Request URL
     * @returns {Promise<void>}
     */
    async updateCurrentTabName(method, url) {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (!activeTabId) {return;}

            const activeTab = await this.service.getActiveTab();
            if (!activeTab) {return;}

            // Don't auto-rename if user has customized the name
            if (activeTab.name !== 'New Request' && !activeTab.name.match(/^(GET|POST|PUT|DELETE|PATCH)/)) {
                return;
            }

            const newName = this.service.generateTabName(method, url);
            await this.service.updateTab(activeTabId, { name: newName });
            this.tabBar.updateTab(activeTabId, { name: newName });
        } catch (error) {
            void error;
        }
    }

    /**
     * Loads an endpoint from a collection into current or new tab
     *
     * Processes endpoint data including URL construction with baseUrl, path parameters,
     * query parameters, headers, body, and authentication configuration.
     * Prioritizes persisted data over OpenAPI spec defaults.
     *
     * @async
     * @param {Object} endpoint - The endpoint object to load
     * @param {string} endpoint.path - Endpoint path
     * @param {string} endpoint.method - HTTP method
     * @param {string} [endpoint.collectionBaseUrl] - Collection base URL
     * @param {Object} [endpoint.parameters] - OpenAPI parameters (path, query, header)
     * @param {Object} [endpoint.requestBody] - OpenAPI request body schema
     * @param {Object} [endpoint.security] - OpenAPI security configuration
     * @param {Object} [endpoint.persistedPathParams] - Previously saved path params
     * @param {Object} [endpoint.persistedQueryParams] - Previously saved query params
     * @param {Object} [endpoint.persistedHeaders] - Previously saved headers
     * @param {string} [endpoint.persistedBody] - Previously saved request body
     * @param {Object} [endpoint.persistedAuthConfig] - Previously saved auth config
     * @param {boolean} [inNewTab=false] - Whether to load in a new tab instead of current
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

            if (endpoint.protocol === 'grpc') {
                const grpcData = endpoint.grpcData || {};
                const tabName = endpoint.name || 'gRPC Request';

                await this.service.updateTab(targetTabId, {
                    name: tabName,
                    type: 'request',
                    endpoint: {
                        collectionId: endpoint.collectionId,
                        endpointId: endpoint.id,
                        protocol: 'grpc'
                    },
                    request: {
                        protocol: 'grpc',
                        grpc: {
                            target: grpcData.target || '',
                            service: grpcData.service || '',
                            fullMethod: grpcData.fullMethod || endpoint.path || '',
                            requestJson: grpcData.requestJson || '{}',
                            metadata: grpcData.metadata || {},
                            useTls: grpcData.useTls || false
                        }
                    },
                    isModified: false
                });

                const tab = await this.service.getActiveTab();
                if (tab) {
                    this._updateUIForTabType(tab);
                    this.responseContainerManager.showContainer(targetTabId);
                    this.isRestoringState = true;
                    await this.stateManager.restoreTabState(tab);
                    this.isRestoringState = false;
                    this.tabBar.updateTab(targetTabId, { name: tabName, isModified: false });
                }

                if (window.scriptController && endpoint.collectionId && endpoint.id) {
                    await window.scriptController.loadScriptsForEndpoint(endpoint.collectionId, endpoint.id);
                }

                return;
            }

            // Use persisted URL if available, otherwise construct from endpoint
            let fullUrl;
            if (endpoint.persistedUrl) {
                // Use the persisted URL (user has edited it)
                fullUrl = endpoint.persistedUrl;
            } else {
                // Construct URL with {{baseUrl}} if collection has a baseUrl
                // but only if path doesn't already contain {{baseUrl}}
                fullUrl = endpoint.path;
                if (endpoint.collectionBaseUrl && !endpoint.path.includes('{{baseUrl}}')) {
                    fullUrl = `{{baseUrl}}${  endpoint.path}`;
                }

                // Replace path parameters with {{paramName}} format
                if (endpoint.parameters?.path) {
                    Object.entries(endpoint.parameters.path).forEach(([key, _param]) => {
                        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const singleBraceParamRegex = new RegExp(`(?<!\\{)\\{${escapedKey}\\}(?!\\})`, 'g');
                        fullUrl = fullUrl.replace(singleBraceParamRegex, `{{${key}}}`);
                    });
                }
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
                bodyString = JSON.stringify({ 'data': 'example' }, null, 2);
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
                type: 'request',
                endpoint: {
                    collectionId: endpoint.collectionId,
                    endpointId: endpoint.id,
                    protocol: 'http'
                },
                request: {
                    protocol: 'http',
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
                this._updateUIForTabType(tab);
                this.responseContainerManager.showContainer(targetTabId);
                this.isRestoringState = true;
                await this.stateManager.restoreTabState(tab);
                this.isRestoringState = false;
                this.tabBar.updateTab(targetTabId, { name: tabName, isModified: false });
            }

            // Load scripts for this endpoint
            if (window.scriptController && endpoint.collectionId && endpoint.id) {
                await window.scriptController.loadScriptsForEndpoint(endpoint.collectionId, endpoint.id);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves current tab state from UI
     *
     * Captures form state via state manager and persists to service.
     *
     * @async
     * @private
     * @returns {Promise<void>}
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
            void error;
        }
    }

    /**
     * Handles service events
     *
     * Can be extended to handle various service events.
     * Currently most updates are handled directly in methods.
     *
     * @param {string} _event - Event name (unused)
     * @param {*} _data - Event data (unused)
     * @private
     * @returns {void}
     */
    _handleServiceEvent(_event, _data) {
        // Can be extended to handle various service events
        // For now, most updates are handled directly in methods
    }

    /**
     * Gets the currently active tab
     *
     * @async
     * @returns {Promise<Object|null>} The active tab object, or null if none
     */
    async getActiveTab() {
        return this.service.getActiveTab();
    }
}
