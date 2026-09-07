/**
 * @fileoverview Controller for coordinating workspace tab operations between UI and services
 * @module controllers/WorkspaceTabController
 */

import { app } from '../appContext.js';
import { flushPendingSaves, registerPendingSave } from '../state/pendingSaves.js';
import { debounce } from '../utils/debounce.js';
import { WorkspaceTabEndpointLoaderService } from '../services/WorkspaceTabEndpointLoaderService.js';
import { handleGraphQLSubscriptionCancel, isSubscriptionActive, clearGraphQLSubscriptionState } from '../graphqlSubscriptionHandler.js';
import { clearWebSocketState } from '../websocketHandler.js';
import { clearSseState } from '../sseHandler.js';
import { clearMqttState } from '../mqttHandler.js';
import { clearStreamState } from '../grpcStreamHandler.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';

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
     * @param {WorkspaceTabService} service
     * @param {WorkspaceTabBar} tabBar
     * @param {WorkspaceTabStateManager} stateManager
     * @param {ResponseContainerManager} responseContainerManager
     */
    constructor(service, tabBar, stateManager, responseContainerManager) {
        this.service = service;
        this.tabBar = tabBar;
        this.stateManager = stateManager;
        this.responseContainerManager = responseContainerManager;
        this.isRestoringState = false;
        this._tabLock = Promise.resolve();
        this._latestSwitchTarget = null;
        this._modifiedTabIds = new Set();
        this._inFlightStatePersist = null;
        this._debouncedPersistState = debounce((tabId) => {
            this._inFlightStatePersist = this._persistActiveTabState(tabId).finally(() => {
                this._inFlightStatePersist = null;
            });
            return this._inFlightStatePersist;
        }, 1500);
        registerPendingSave({
            flush: () => this._flushPendingStatePersist(),
            cancel: () => this._debouncedPersistState.cancel()
        });

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
     * @param {function(): Promise<*>} operation
     * @returns {Promise<*>}
     */
    async _withTabLock(operation) {
        const previous = this._tabLock;
        const current = previous.catch(() => {}).then(operation);
        this._tabLock = current;
        return current;
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async _persistActiveTabState(tabId) {
        if (this.isRestoringState || !tabId) {
            return;
        }
        try {
            const currentState = await this.stateManager.captureCurrentState();
            await this.service.updateTab(tabId, currentState);
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async _flushPendingStatePersist() {
        await this._debouncedPersistState.flush();
        await this._inFlightStatePersist;
    }

    /** @returns {Promise<void>} */
    async initialize() {
        return this._withTabLock(() => this._doInitialize());
    }

    /** @returns {Promise<void>} */
    async _doInitialize() {
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
     * @param {Object} [options={}]
     * @param {string} [options.name]
     * @returns {Promise<Object>}
     */
    async createNewTab(options = {}) {
        return this._withTabLock(() => this._doCreateNewTab(options));
    }

    /**
     * @param {Object} [options={}]
     * @returns {Promise<Object>}
     */
    async _doCreateNewTab(options = {}) {
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
                    body: { mode: 'json', content: '' },
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
                        useTls: false,
                        protoPath: null,
                        clientStreaming: false,
                        serverStreaming: false
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
                await app.scriptController.clearScripts();
            }

            return newTab;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    /** @returns {Promise<Object>} */
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

    /** @param {string} tabId */
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

    /** @param {string} tabId */
    _cleanupRunnerTab(tabId) {
        const runnerContainer = document.getElementById(`runner-container-${tabId}`);
        if (runnerContainer) {
            runnerContainer.remove();
        }

        this.runnerControllers.get(tabId)?.destroy?.();
        this.runnerControllers.delete(tabId);
    }

    /**
     * @param {string} tabId
     * @returns {void}
     */
    _cleanupClosedTabUI(tabId) {
        this._modifiedTabIds.delete(tabId);
        if (this.runnerControllers.has(tabId)) {
            this._cleanupRunnerTab(tabId);
        }
        this._teardownTabConnections(tabId);
        this.responseContainerManager.removeContainer(tabId);
    }

    /**
     * @param {string} tabId
     * @returns {void}
     */
    _teardownTabConnections(tabId) {
        if (!tabId) {
            return;
        }
        const clearers = [
            clearWebSocketState,
            clearSseState,
            clearMqttState,
            clearStreamState,
            clearGraphQLSubscriptionState
        ];
        for (const clear of clearers) {
            Promise.resolve(clear(tabId)).catch(() => {});
        }
    }

    /** @param {Object} tab */
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
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async switchTab(tabId) {
        this._latestSwitchTarget = tabId;
        return this._withTabLock(() => this._doSwitchTab(tabId));
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async _doSwitchTab(tabId) {
        try {
            if (this._latestSwitchTarget !== tabId) {
                return;
            }

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
                    await app.scriptController.clearScripts();
                }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async closeTab(tabId) {
        return this._withTabLock(() => this._doCloseTab(tabId));
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async _doCloseTab(tabId) {
        try {
            await flushPendingSaves();

            const previousActiveTabId = await this.service.getActiveTabId();
            const allTabs = await this.service.getAllTabs();
            const tab = allTabs.find(t => t.id === tabId);
            if (tab?.isModified) {
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
                await this._doCreateNewTab();
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

            if (result.newActiveTabId !== previousActiveTabId) {
                const newActiveTab = remainingTabs.find(t => t.id === result.newActiveTabId);
                if (newActiveTab) {
                    await this._activateTab(newActiveTab);
                }
            }
        } catch (error) {
            void error;
        }
    }

    /** @param {Object} tab */
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
     * @param {string} tabId
     * @param {string} newName
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
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async duplicateTab(tabId) {
        return this._withTabLock(() => this._doDuplicateTab(tabId));
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async _doDuplicateTab(tabId) {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (tabId === activeTabId) {
                await this._saveCurrentTabState();
            }

            const newTab = await this.service.duplicateTab(tabId);
            if (newTab) {
                const tabs = await this.service.getAllTabs();
                this.tabBar.render(tabs, activeTabId);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async closeOtherTabs(tabId) {
        return this._withTabLock(() => this._doCloseOtherTabs(tabId));
    }

    /**
     * @param {string} tabId
     * @returns {Promise<void>}
     */
    async _doCloseOtherTabs(tabId) {
        try {
            await flushPendingSaves();

            const previousActiveTabId = await this.service.getActiveTabId();
            const tabs = await this.service.getAllTabs();
            const tabsToClose = tabs.filter(t => t.id !== tabId);

            const modifiedCount = tabsToClose.filter(t => t.isModified).length;
            if (modifiedCount > 0) {
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

            if (tabId !== previousActiveTabId) {
                const activeTab = remainingTabs.find(t => t.id === tabId);
                if (activeTab) {
                    await this._activateTab(activeTab);
                }
            }
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async markCurrentTabModified() {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (!activeTabId) {
                return;
            }

            this._debouncedPersistState(activeTabId);

            if (this._modifiedTabIds.has(activeTabId)) {
                return;
            }
            this._modifiedTabIds.add(activeTabId);

            await this.service.setTabModified(activeTabId, true);
            this.tabBar.updateTab(activeTabId, { isModified: true });
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async markCurrentTabUnmodified() {
        try {
            const activeTabId = await this.service.getActiveTabId();
            if (activeTabId) {
                this._modifiedTabIds.delete(activeTabId);
                await this.service.setTabModified(activeTabId, false);
                this.tabBar.updateTab(activeTabId, { isModified: false });
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {string} method
     * @param {string} url
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
     * @param {Object} endpoint
     * @param {string} endpoint.path
     * @param {string} endpoint.method
     * @param {string} [endpoint.collectionBaseUrl]
     * @param {Object} [endpoint.parameters]
     * @param {Object} [endpoint.requestBody]
     * @param {Object} [endpoint.security]
     * @param {Object} [endpoint.persistedPathParams]
     * @param {Object} [endpoint.persistedQueryParams]
     * @param {Object} [endpoint.persistedHeaders]
     * @param {string} [endpoint.persistedBody]
     * @param {Object} [endpoint.persistedAuthConfig]
     * @param {boolean} [inNewTab=false]
     * @returns {Promise<void>}
     */
    async loadEndpoint(endpoint, inNewTab = false) {
        return this._withTabLock(() => this._doLoadEndpoint(endpoint, inNewTab));
    }

    /**
     * @param {Object} endpoint
     * @param {boolean} [inNewTab=false]
     * @returns {Promise<void>}
     */
    async _doLoadEndpoint(endpoint, inNewTab = false) {
        try {
            let targetTabId;

            if (inNewTab) {
                const newTab = await this._doCreateNewTab({ protocol: endpoint.protocol });
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
     * @param {Object} historyEntry
     * @returns {Promise<void>}
     */
    async loadHistoryEntry(historyEntry) {
        return this._withTabLock(() => this._doLoadHistoryEntry(historyEntry));
    }

    /**
     * @param {Object} historyEntry
     * @returns {Promise<void>}
     */
    async _doLoadHistoryEntry(historyEntry) {
        try {
            if (!historyEntry) {
                return;
            }

            if (historyEntry.id) {
                const tabs = await this.service.getAllTabs();
                const existingTab = tabs.find(tab => tab.historyEntryId === historyEntry.id);
                if (existingTab) {
                    this._latestSwitchTarget = existingTab.id;
                    await this._doSwitchTab(existingTab.id);
                    return;
                }
            }

            const protocol = historyEntry.request?.protocol || 'http';
            const newTab = await this._doCreateNewTab({ protocol });

            await this.endpointLoader.loadHistoryEntry(historyEntry, newTab.id);
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async _saveCurrentTabState() {
        try {
            await flushPendingSaves();

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
     * @param {string} _event
     * @param {*} _data
     * @returns {void}
     */
    _handleServiceEvent(_event, _data) {
    }

    /**
     * @param {Array<string>} orderedTabIds
     * @returns {Promise<void>}
     */
    async reorderTabs(orderedTabIds) {
        try {
            await this.service.reorderTabs(orderedTabIds);
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<Object|null>} */
    async getActiveTab() {
        return this.service.getActiveTab();
    }
}
