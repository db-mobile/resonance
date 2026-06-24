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
import { app } from '../appContext.js';
import { WorkspaceTabEndpointLoaderService } from '../services/WorkspaceTabEndpointLoaderService.js';
import { handleGraphQLSubscriptionCancel, isSubscriptionActive } from '../graphqlSubscriptionHandler.js';

/**
 * Default endpoint and query seeded into a freshly created GraphQL tab so users
 * have a runnable example. Points at the public Countries API (no auth, CORS-friendly).
 */
const DEFAULT_GRAPHQL_URL = 'https://countries.trevorblades.com/';
const DEFAULT_GRAPHQL_QUERY = `query GetCountry($code: ID!) {
  country(code: $code) {
    name
    native
    capital
    currency
    emoji
    languages {
      code
      name
    }
  }
}
`;
const DEFAULT_GRAPHQL_VARIABLES = `{
  "code": "DE"
}`;

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
        this.isRestoringState = false;

        this.runnerControllers = new Map();
        this.endpointLoader = new WorkspaceTabEndpointLoaderService({
            service: this.service,
            stateManager: this.stateManager,
            responseContainerManager: this.responseContainerManager,
            tabBar: this.tabBar,
            updateUIForTabType: (tab) => this._updateUIForTabType(tab),
            restoreTabStateSafely: (tab) => this._restoreTabStateSafely(tab)
        });

        this.tabBar.onTabSwitch = (tabId) => this.switchTab(tabId);
        this.tabBar.onTabClose = (tabId) => this.closeTab(tabId);
        this.tabBar.onTabCreate = (protocol) => this.createNewTab({ protocol });
        this.tabBar.onTabRename = (tabId, newName) => this.renameTab(tabId, newName);
        this.tabBar.onTabDuplicate = (tabId) => this.duplicateTab(tabId);
        this.tabBar.onCloseOthers = (tabId) => this.closeOtherTabs(tabId);
        this.tabBar.onRunnerTabCreate = () => this.createRunnerTab();
        this.tabBar.onTabReorder = (orderedTabIds) => this.reorderTabs(orderedTabIds);

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

            this.tabBar.render(tabs, activeTabId);

            if (activeTabId) {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab) {
                    this._updateUIForTabType(activeTab);

                    if (activeTab.type === 'runner') {
                        await this._initializeRunnerTab(activeTabId);
                    } else {
                        this.responseContainerManager.showContainer(activeTabId);
                        await this._restoreTabStateSafely(activeTab);
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
            await this._saveCurrentTabState();

            const { protocol = 'http', ...tabOptions } = options;

            if (protocol === 'websocket') {
                tabOptions.name = tabOptions.name || 'New WebSocket';
                tabOptions.request = {
                    protocol: 'websocket',
                    url: '',
                    method: 'WS',
                    pathParams: {},
                    queryParams: {},
                    headers: {},
                    body: { mode: 'json', content: '' },
                    authType: 'none',
                    authConfig: {}
                };
            } else if (protocol === 'sse') {
                tabOptions.name = tabOptions.name || 'New SSE';
                tabOptions.request = {
                    protocol: 'sse',
                    url: '',
                    method: 'GET',
                    pathParams: {},
                    queryParams: {},
                    headers: {},
                    body: { mode: 'none', content: '' },
                    authType: 'none',
                    authConfig: {}
                };
            } else if (protocol === 'grpc') {
                tabOptions.name = tabOptions.name || 'New gRPC';
                tabOptions.request = {
                    protocol: 'grpc',
                    grpc: {
                        target: '',
                        service: '',
                        fullMethod: '',
                        requestJson: '{}',
                        metadata: {},
                        useTls: false
                    }
                };
            } else if (protocol === 'graphql') {
                tabOptions.name = tabOptions.name || 'New GraphQL';
                tabOptions.request = {
                    protocol: 'graphql',
                    url: DEFAULT_GRAPHQL_URL,
                    method: 'POST',
                    query: DEFAULT_GRAPHQL_QUERY,
                    variables: DEFAULT_GRAPHQL_VARIABLES,
                    operationName: null,
                    headers: {},
                    authType: 'none',
                    authConfig: {}
                };
            } else if (protocol === 'mqtt') {
                tabOptions.name = tabOptions.name || 'New MQTT';
                tabOptions.request = {
                    protocol: 'mqtt',
                    broker: '',
                    method: 'MQTT',
                    clientId: '',
                    username: '',
                    password: '',
                    subscribeTopic: '',
                    publishTopic: '',
                    qos: 0,
                    body: { mode: 'json', content: '' },
                    authType: 'none',
                    authConfig: {}
                };
            }

            const newTab = await this.service.createTab(tabOptions);
            await this.service.switchTab(newTab.id);

            this._updateUIForTabType(newTab);

            this.responseContainerManager.showContainer(newTab.id);

            const tabs = await this.service.getAllTabs();
            this.tabBar.render(tabs, newTab.id);

            await this._restoreTabStateSafely(newTab);

            if (app.scriptController) {
                app.scriptController.clearScripts();
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
            await this._saveCurrentTabState();

            const newTab = await this.service.createTab({
                name: 'Collection Runner',
                type: 'runner'
            });
            await this.service.switchTab(newTab.id);

            const tabs = await this.service.getAllTabs();
            const activeTabId = await this.service.getActiveTabId();
            this.tabBar.render(tabs, activeTabId);

            this._updateUIForTabType(newTab);

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
        const { RunnerController } = await import('./RunnerController.js');
        const { getCollections } = await import('../collectionManager.js');

        const mainContentArea = document.getElementById('main-content-area');
        if (!mainContentArea) {return;}

        const requestBuilder = mainContentArea.querySelector('.request-builder');
        const requestConfig = mainContentArea.querySelector('.request-config');
        const resizerHandle = mainContentArea.querySelector('.resizer-handle');
        const responseArea = mainContentArea.querySelector('.response-area');

        if (requestBuilder) {requestBuilder.classList.add('is-hidden');}
        if (requestConfig) {requestConfig.classList.add('is-hidden');}
        if (resizerHandle) {resizerHandle.classList.add('is-hidden');}
        if (responseArea) {responseArea.classList.add('is-hidden');}

        let runnerContainer = document.getElementById(`runner-container-${tabId}`);
        if (!runnerContainer) {
            runnerContainer = document.createElement('div');
            runnerContainer.id = `runner-container-${tabId}`;
            runnerContainer.className = 'runner-container';
            runnerContainer.style.flex = '1';
            runnerContainer.style.display = 'flex';
            runnerContainer.style.flexDirection = 'column';
            runnerContainer.style.overflow = 'hidden';

            const tabBarContainer = document.getElementById('workspace-tab-bar-container');
            if (tabBarContainer && tabBarContainer.nextSibling) {
                mainContentArea.insertBefore(runnerContainer, tabBarContainer.nextSibling);
            } else {
                mainContentArea.appendChild(runnerContainer);
            }
        }

        const runnerController = new RunnerController(
            window.backendAPI,
            () => getCollections()
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
        const runnerContainer = document.getElementById(`runner-container-${tabId}`);
        if (runnerContainer) {
            runnerContainer.remove();
        }

        this.runnerControllers.delete(tabId);
    }

    /**
     * Cleans up controller-managed UI resources for a closed tab.
     *
     * @private
     * @param {string} tabId - The closed tab ID
     * @returns {void}
     */
    _cleanupClosedTabUI(tabId) {
        if (this.runnerControllers.has(tabId)) {
            this._cleanupRunnerTab(tabId);
        }
        if (window.backendAPI?.mqtt) {
            window.backendAPI.mqtt.close(tabId);
        }
        if (window.backendAPI?.graphqlSubscription) {
            window.backendAPI.graphqlSubscription.close(tabId);
        }
        this.responseContainerManager.removeContainer(tabId);
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

        const runnerContainers = mainContentArea.querySelectorAll('[id^="runner-container-"]');
        runnerContainers.forEach(c => c.classList.add('is-hidden'));

        if (tab.type === 'runner') {
            if (requestBuilder) {requestBuilder.classList.add('is-hidden');}
            if (requestConfig) {requestConfig.classList.add('is-hidden');}
            if (resizerHandle) {resizerHandle.classList.add('is-hidden');}
            if (responseArea) {responseArea.classList.add('is-hidden');}

            const runnerContainer = document.getElementById(`runner-container-${tab.id}`);
            if (runnerContainer) {
                runnerContainer.classList.remove('is-hidden');
            }
        } else {
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
                return;
            }

            if (currentTabId && isSubscriptionActive(currentTabId)) {
                await handleGraphQLSubscriptionCancel();
            }

            await this._saveCurrentTabState();

            const tab = await this.service.switchTab(tabId);
            if (!tab) {
                return;
            }

            this._updateUIForTabType(tab);

            if (tab.type !== 'runner') {
                this.responseContainerManager.showContainer(tabId);
            }

            this.tabBar.setActiveTab(tabId);

            if (tab.type === 'runner') {
                if (!this.runnerControllers.has(tabId)) {
                    await this._initializeRunnerTab(tabId);
                }
                return;
            }

            await this._restoreTabStateSafely(tab);

            if (app.scriptController) {
                if (tab.endpoint && tab.endpoint.collectionId && tab.endpoint.endpointId) {
                    await app.scriptController.loadScriptsForEndpoint(
                        tab.endpoint.collectionId,
                        tab.endpoint.endpointId
                    );
                } else {
                    app.scriptController.clearScripts();
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
            const allTabs = await this.service.getAllTabs();
            const tab = allTabs.find(t => t.id === tabId);
            if (tab?.isModified) {
                const { ConfirmDialog } = await import('../ui/ConfirmDialog.js');
                const dialog = new ConfirmDialog();
                const confirmed = await dialog.show(
                    `"${tab.name}" has unsaved changes. Close anyway?`,
                    {
                        title: 'Unsaved Changes',
                        confirmText: 'Close',
                        cancelText: 'Keep Open',
                        dangerous: true
                    }
                );
                if (!confirmed) {
                    return;
                }
            }

            if (allTabs.length === 1) {
                this._cleanupClosedTabUI(tabId);
                await this.createNewTab();
                await this.service.closeTab(tabId);
                const remainingTabs = await this.service.getAllTabs();
                const activeTabId = await this.service.getActiveTabId();
                this.tabBar.render(remainingTabs, activeTabId);
                return;
            }

            this._cleanupClosedTabUI(tabId);

            const result = await this.service.closeTab(tabId);
            if (!result) {
                return;
            }

            const remainingTabs = allTabs.filter(t => t.id !== tabId);
            this.tabBar.render(remainingTabs, result.newActiveTabId);

            if (result.newActiveTabId !== tabId) {
                const newActiveTab = remainingTabs.find(t => t.id === result.newActiveTabId);
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
            await this._restoreTabStateSafely(tab);
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

            const modifiedCount = tabsToClose.filter(t => t.isModified).length;
            if (modifiedCount > 0) {
                const { ConfirmDialog } = await import('../ui/ConfirmDialog.js');
                const dialog = new ConfirmDialog();
                const confirmed = await dialog.show(
                    modifiedCount === 1
                        ? '1 tab has unsaved changes. Close anyway?'
                        : `${modifiedCount} tabs have unsaved changes. Close anyway?`,
                    {
                        title: 'Unsaved Changes',
                        confirmText: 'Close All',
                        cancelText: 'Keep Open',
                        dangerous: true
                    }
                );
                if (!confirmed) {
                    return;
                }
            }

            for (const tab of tabsToClose) {
                this._cleanupClosedTabUI(tab.id);
                await this.service.closeTab(tab.id);
            }

            await this.service.switchTab(tabId);

            const remainingTabs = await this.service.getAllTabs();
            this.tabBar.render(remainingTabs, tabId);

            const activeTab = remainingTabs.find(t => t.id === tabId);
            if (activeTab) {
                await this._activateTab(activeTab);
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

            await this.endpointLoader.loadEndpoint(endpoint, targetTabId);
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

            const ep = currentState.endpoint;
            if (ep && ep.collectionId && ep.endpointId && app.collectionController) {
                await app.collectionController.saveRequestBodyModification(
                    ep.collectionId,
                    ep.endpointId
                );
            }
        } catch (error) {
            void error;
        }
    }

    async _restoreTabStateSafely(tab) {
        this.isRestoringState = true;
        try {
            await this.stateManager.restoreTabState(tab);
        } finally {
            this.isRestoringState = false;
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
    }

    /**
     * Reorders tabs based on an ordered list of tab IDs
     *
     * @async
     * @param {Array<string>} orderedTabIds - Tab IDs in the desired order
     * @returns {Promise<void>}
     */
    async reorderTabs(orderedTabIds) {
        try {
            await this.service.reorderTabs(orderedTabIds);
        } catch (error) {
            void error;
        }
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
