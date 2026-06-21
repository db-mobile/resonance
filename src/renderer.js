/**
 * @fileoverview Main renderer process orchestrator for Resonance
 * @module renderer
 *
 * Initializes and coordinates all UI modules, controllers, services, and repositories.
 * Sets up event listeners, keyboard shortcuts, and manages the application lifecycle
 * in the renderer process.
 */

// Import ipcBridge first to set up window.backendAPI before any other modules
import { getCurrentEndpoint, setCurrentEndpoint } from './modules/state/currentEndpoint.js';
import { app } from './modules/appContext.js';
import './modules/ipcBridge.js';

import { sendRequestBtn, cancelRequestBtn, curlBtn, importCollectionBtn, urlInput, methodSelect, bodyInput, bodyEditorContainer, bodyTextEditorContainer, grpcBodyInput, grpcBodyEditorContainer } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl, setUrlUpdating } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { initializeScriptSubTabs } from './modules/scriptSubTabs.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest, handleCancelRequest, handleGenerateCurl, setGraphQLBodyManager, invalidateSettingsCache, getSettingsCache, invalidateEnvironmentCache } from './modules/apiHandler.js';
import { GraphQLBodyManager } from './modules/graphqlBodyManager.js';
import { FormBodyManager } from './modules/formBodyManager.js';
import { initGrpcUI, setGrpcMetadata, setGrpcTls } from './modules/grpcHandler.js';
import { initRequestModeManager } from './modules/requestModeManager.js';
import { initWebSocketHandler } from './modules/websocketHandler.js';
import { initSseHandler } from './modules/sseHandler.js';
import { initMqttHandler, handleMqttCancel } from './modules/mqttHandler.js';
import { initGrpcStreamHandler } from './modules/grpcStreamHandler.js';
import { loadCollections, importOpenApiFile, importPostmanCollection, importPostmanEnvironment, importCurl, initializeBodyTracking } from './modules/collectionManager.js';
import { ThemeManager, SettingsModal } from './modules/themeManager.js';
import { HttpVersionManager } from './modules/httpVersionManager.js';
import { TimeoutManager } from './modules/timeoutManager.js';
import { initResizer } from './modules/resizer.js';
import { i18n } from './i18n/I18nManager.js';
import { authManager } from './modules/authManager.js';
import { initializeCopyHandler } from './modules/copyHandler.js';
import { SecretStore } from './modules/storage/SecretStore.js';
import { StatusBar } from './modules/ui/StatusBar.js';
import { ContextMenu } from './modules/ui/ContextMenu.js';
import { FeatureRegistry } from './modules/registry/FeatureRegistry.js';
import { proxyFeature } from './modules/proxy.feature.js';
import { certificateFeature } from './modules/certificate.feature.js';
import { cookieFeature } from './modules/cookie.feature.js';
import { environmentFeature } from './modules/environment.feature.js';
import { scriptFeature } from './modules/script.feature.js';
import { mockServerFeature } from './modules/mockServer.feature.js';
import { schemaFeature } from './modules/schema.feature.js';
import { historyFeature } from './modules/history.feature.js';
import { workspaceTabFeature } from './modules/workspaceTab.feature.js';
import { StatusDisplayAdapter } from './modules/interfaces/IStatusDisplay.js';
import { keyboardShortcuts } from './modules/keyboardShortcuts.js';
import { CollectionRepository } from './modules/storage/CollectionRepository.js';
import { RequestBodyEditor } from './modules/requestBodyEditor.bundle.js';
import { UrlAutocomplete } from './modules/ui/UrlAutocomplete.js';
import { toast } from './modules/ui/Toast.js';

const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const timeoutManager = new TimeoutManager();

// Expose settings cache invalidation so themeManager/httpVersionManager/timeoutManager
// can bust it when the user saves new settings
app.invalidateApiHandlerSettingsCache = invalidateSettingsCache;
app.getApiHandlerSettingsCache = getSettingsCache;
app.invalidateApiHandlerEnvironmentCache = invalidateEnvironmentCache;

// Initialize shared status display adapter
const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);

// Shared secret backend: stores secret values in the OS keychain (encryption at rest),
// keeping them out of the plaintext store, exports, and git-friendly collection files.
// Exposed globally for the auth request path. Falls back to encrypted-at-rest-free local
// storage only when no keychain is available, warning the user once.
const secretStore = new SecretStore(window.backendAPI, {
    onFallback: () => toast.warning(
        'No OS keychain available — secrets are stored locally without encryption at rest.'
    )
});
app.secretStore = secretStore;

// Shared singletons consumed by registry features but not themselves registry-managed:
// the collection repository (mock-server + schema) and the GraphQL body manager (workspace
// tab state). Both are published onto the registry bus below.
const collectionRepository = new CollectionRepository(window.backendAPI, secretStore);

// Initialize GraphQL body manager (also used by apiHandler and the workspace tab feature).
const graphqlBodyManager = new GraphQLBodyManager({
    bodyInput,
    graphqlQueryEditor: document.getElementById('graphql-query-editor'),
    graphqlVariablesEditor: document.getElementById('graphql-variables-editor'),
    graphqlFormatBtn: document.getElementById('graphql-format-btn')
});
graphqlBodyManager.initialize();
setGraphQLBodyManager(graphqlBodyManager);
app.graphqlBodyManager = graphqlBodyManager;

// Registry-managed features: each declares its own wiring in a co-located *.feature.js
// descriptor (Repository → Service → Controller → UI), so adding/removing one no longer
// means hand-editing the orchestration order here. The registry applies `globals` (window.*
// exposure), publishes `provides` onto the shared bus, and runs each feature's init hook on
// boot. Registration order matters where one feature consumes another's provided singleton
// (cookie/script consume environment's `environmentService`; mock/schema/workspace consume
// the collection repository / GraphQL body manager provided below).
const featureRegistry = new FeatureRegistry({
    backendAPI: window.backendAPI,
    statusDisplay: statusDisplayAdapter,
    secretStore,
    toast,
    _shared: new Map(),
    provide(name, value) {
        this._shared.set(name, value);
        return value;
    },
    get(name) {
        return this._shared.get(name);
    },
});
featureRegistry.provide('collectionRepository', collectionRepository);
featureRegistry.provide('graphqlBodyManager', graphqlBodyManager);
featureRegistry
    .register(environmentFeature)
    .register(proxyFeature)
    .register(certificateFeature)
    .register(cookieFeature)
    .register(scriptFeature)
    .register(mockServerFeature)
    .register(schemaFeature)
    .register(historyFeature)
    .register(workspaceTabFeature)
    .boot();

// Capture instances still referenced directly below. Globals (window.*) and the shared bus
// are wired by the registry; these locals cover the remaining by-name references in this file
// (e.g. SettingsModal, the cookie-jar button, deferred init in idle tiers, beforeunload save).
const environment = featureRegistry.get('environment');
const environmentController = environment.controller;
const environmentService = environment.service;
const environmentSelector = environment.selector;
const proxyController = featureRegistry.get('proxy').controller;
const certificateController = featureRegistry.get('certificate').controller;
const cookieController = featureRegistry.get('cookie').controller;
const mockServer = featureRegistry.get('mockServer');
const mockServerController = mockServer.controller;
const mockServerDialog = mockServer.dialog;
const historyController = featureRegistry.get('history').controller;
const workspaceTab = featureRegistry.get('workspaceTab');
const workspaceTabController = workspaceTab.controller;
const workspaceTabService = workspaceTab.service;
const workspaceTabStateManager = workspaceTab.stateManager;

// Initialize form-data / URL-encoded body manager
const formBodyManager = new FormBodyManager();
formBodyManager.initialize();
app.formBodyManager = formBodyManager;

// Initialize settings modal with all managers
const settingsModal = new SettingsModal(themeManager, i18n, httpVersionManager, timeoutManager, proxyController, certificateController);

/**
 * Initializes application keyboard shortcuts
 *
 * Registers all keyboard shortcuts for the application including:
 * - Request actions (send, cancel, generate cURL)
 * - Navigation (focus URL, toggle sidebars)
 * - Tab switching (request tabs, workspace tabs)
 * - Settings and help
 *
 * Uses platform-aware modifier keys (Cmd on macOS, Ctrl on Windows/Linux).
 *
 * @returns {void}
 */
function initKeyboardShortcuts() {
    // Initialize the shortcuts manager
    keyboardShortcuts.init();

    // Request Actions
    keyboardShortcuts.register('Enter', {
        ctrl: true,
        handler: () => {
            if (sendRequestBtn && !sendRequestBtn.disabled) {
                handleSendRequest();
            }
        },
        description: 'Send request',
        category: 'Request'
    });

    keyboardShortcuts.register('KeyS', {
        ctrl: true,
        handler: async () => {
            if (getCurrentEndpoint()) {
                const { saveAllRequestModifications } = await import('./modules/collectionManager.js');
                await saveAllRequestModifications(
                    getCurrentEndpoint().collectionId,
                    getCurrentEndpoint().endpointId
                );
                if (app.workspaceTabController) {
                    await app.workspaceTabController.markCurrentTabUnmodified();
                }
            } else if (app.workspaceTabController) {
                // No endpoint loaded - show "Save to Collection" dialog
                const { saveRequestToCollection } = await import('./modules/collectionManager.js');
                const activeTab = await app.workspaceTabController.service.getActiveTab();
                if (activeTab && activeTab.type !== 'runner') {
                    const state = await app.workspaceTabController.stateManager.captureCurrentState();
                    const requestData = {
                        name: activeTab.name,
                        ...state.request
                    };
                    const result = await saveRequestToCollection(requestData);
                    if (result) {
                        // Update current endpoint and tab
                        setCurrentEndpoint({
                            collectionId: result.collectionId,
                            endpointId: result.endpointId
                        });
                        await app.workspaceTabController.service.updateTab(activeTab.id, {
                            name: result.name,
                            endpoint: {
                                collectionId: result.collectionId,
                                endpointId: result.endpointId,
                                protocol: state.request.protocol || 'http'
                            }
                        });
                        app.workspaceTabController.tabBar.updateTab(activeTab.id, { name: result.name });
                        await app.workspaceTabController.markCurrentTabUnmodified();
                    }
                }
            }
        },
        description: 'Save request',
        category: 'Request'
    });

    keyboardShortcuts.register('Escape', {
        handler: () => {
            if (cancelRequestBtn && !cancelRequestBtn.disabled) {
                handleCancelRequest();
            }
        },
        description: 'Cancel request',
        category: 'Request'
    });

    // Navigation & UI
    keyboardShortcuts.register('KeyL', {
        ctrl: true,
        handler: (_e) => {
            if (urlInput) {
                urlInput.focus();
                urlInput.select();
            }
        },
        description: 'Focus URL bar',
        category: 'Navigation'
    });

    keyboardShortcuts.register('KeyH', {
        ctrl: true,
        handler: () => {
            const historySidebar = document.getElementById('history-sidebar');
            const historyResizerHandle = document.getElementById('history-resizer-handle');
            const historyToggleBtn = document.getElementById('history-toggle-btn');
            if (historySidebar && historyResizerHandle) {
                const isVisible = historySidebar.classList.contains('visible');
                if (isVisible) {
                    historySidebar.classList.remove('visible');
                    historyResizerHandle.classList.remove('visible');
                    if (historyToggleBtn) {historyToggleBtn.classList.remove('active');}
                } else {
                    historySidebar.classList.add('visible');
                    historyResizerHandle.classList.add('visible');
                    if (historyToggleBtn) {historyToggleBtn.classList.add('active');}
                }
            }
        },
        description: 'Toggle history sidebar',
        category: 'Navigation'
    });

    keyboardShortcuts.register('KeyJ', {
        ctrl: true,
        handler: () => {
            if (app.cookieController) {
                app.cookieController.openCookieManager();
            }
        },
        description: 'Open cookie jar',
        category: 'Navigation'
    });

    // Actions
    keyboardShortcuts.register('KeyK', {
        ctrl: true,
        handler: () => {
            if (curlBtn) {
                handleGenerateCurl();
            }
        },
        description: 'Generate cURL command',
        category: 'Actions'
    });

    keyboardShortcuts.register('KeyO', {
        ctrl: true,
        handler: () => {
            if (importCollectionBtn) {
                importOpenApiFile();
            }
        },
        description: 'Import OpenAPI collection',
        category: 'Actions'
    });

    keyboardShortcuts.register('KeyE', {
        ctrl: true,
        handler: () => {
            if (environmentController) {
                environmentController.openEnvironmentManager();
            }
        },
        description: 'Open environment manager',
        category: 'Actions'
    });

    // Settings & Help
    keyboardShortcuts.register('Comma', {
        ctrl: true,
        handler: () => {
            if (settingsModal) {
                settingsModal.show();
            }
        },
        description: 'Open settings',
        category: 'Settings'
    });

    keyboardShortcuts.register('Slash', {
        ctrl: true,
        handler: () => {
            keyboardShortcuts.showHelp();
        },
        description: 'Show keyboard shortcuts',
        category: 'Help'
    });

    // Workspace Tab Switching (Ctrl/Cmd+1-9 to switch to specific workspace tabs)
    for (let i = 1; i <= 9; i++) {
        keyboardShortcuts.register(`Digit${i}`, {
            ctrl: true,
            handler: async () => {
                if (workspaceTabController) {
                    const tabs = await workspaceTabController.service.getAllTabs();
                    if (tabs.length >= i) {
                        await workspaceTabController.switchTab(tabs[i - 1].id);
                    }
                }
            },
            description: `Switch to workspace tab ${i}`,
            category: 'Workspace Tabs'
        });
    }

    // Request Tab Switching (Alt+1-6 for request sub-tabs)
    keyboardShortcuts.register('Digit1', {
        alt: true,
        handler: () => activateTab('request', 'path-params'),
        description: 'Switch to Path Params tab',
        category: 'Request Tabs'
    });

    keyboardShortcuts.register('Digit2', {
        alt: true,
        handler: () => activateTab('request', 'query-params'),
        description: 'Switch to Query Params tab',
        category: 'Request Tabs'
    });

    keyboardShortcuts.register('Digit3', {
        alt: true,
        handler: () => activateTab('request', 'headers'),
        description: 'Switch to Headers tab',
        category: 'Request Tabs'
    });

    keyboardShortcuts.register('Digit4', {
        alt: true,
        handler: () => activateTab('request', 'authorization'),
        description: 'Switch to Authorization tab',
        category: 'Request Tabs'
    });

    keyboardShortcuts.register('Digit5', {
        alt: true,
        handler: () => activateTab('request', 'body'),
        description: 'Switch to Body tab',
        category: 'Request Tabs'
    });

    keyboardShortcuts.register('Digit6', {
        alt: true,
        handler: () => activateTab('request', 'scripts'),
        description: 'Switch to Scripts tab',
        category: 'Request Tabs'
    });

    // Workspace Tab shortcuts
    keyboardShortcuts.register('KeyT', {
        ctrl: true,
        handler: () => {
            if (workspaceTabController) {
                workspaceTabController.createNewTab();
            }
        },
        description: 'New workspace tab',
        category: 'Workspace Tabs'
    });

    keyboardShortcuts.register('KeyW', {
        ctrl: true,
        handler: async () => {
            if (workspaceTabController) {
                const activeTabId = await workspaceTabController.service.getActiveTabId();
                if (activeTabId) {
                    await workspaceTabController.closeTab(activeTabId);
                }
            }
        },
        description: 'Close current tab',
        category: 'Workspace Tabs'
    });

    keyboardShortcuts.register('Tab', {
        ctrl: true,
        handler: async () => {
            if (workspaceTabController) {
                const tabs = await workspaceTabController.service.getAllTabs();
                const activeTabId = await workspaceTabController.service.getActiveTabId();
                const currentIndex = tabs.findIndex(t => t.id === activeTabId);
                const nextIndex = (currentIndex + 1) % tabs.length;
                await workspaceTabController.switchTab(tabs[nextIndex].id);
            }
        },
        description: 'Switch to next tab',
        category: 'Workspace Tabs'
    });

    keyboardShortcuts.register('Tab', {
        ctrl: true,
        shift: true,
        handler: async () => {
            if (workspaceTabController) {
                const tabs = await workspaceTabController.service.getAllTabs();
                const activeTabId = await workspaceTabController.service.getActiveTabId();
                const currentIndex = tabs.findIndex(t => t.id === activeTabId);
                const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                await workspaceTabController.switchTab(tabs[prevIndex].id);
            }
        },
        description: 'Switch to previous tab',
        category: 'Workspace Tabs'
    });

    const keyboardShortcutsBtn = document.getElementById('keyboard-shortcuts-btn');
    if (keyboardShortcutsBtn) {
        keyboardShortcutsBtn.addEventListener('click', () => keyboardShortcuts.showHelp());
    }
}

function applyShortcutHints() {
    const hints = [
        { id: 'send-request-btn', key: 'Enter', ctrl: true },
        { id: 'cancel-request-btn', key: 'Escape' },
        { id: 'curl-btn', key: 'KeyK', ctrl: true },
        { id: 'import-collection-btn', key: 'KeyO', ctrl: true },
        { id: 'history-toggle-btn', key: 'KeyH', ctrl: true },
        { id: 'cookie-jar-btn', key: 'KeyJ', ctrl: true },
        { id: 'settings-btn', key: 'Comma', ctrl: true },
    ];

    for (const { id, key, ctrl = false } of hints) {
        const el = document.getElementById(id);
        if (!el) { continue; }
        const display = keyboardShortcuts.lookupDisplayKey(key, ctrl);
        if (!display) { continue; }
        if (el.hasAttribute('data-i18n-title')) {
            // Store on element so updateUI() re-applies after language changes
            el.setAttribute('data-shortcut-hint', display);
            el.title = `${el.title} (${display})`;
        } else {
            const currentTitle = el.title || el.getAttribute('aria-label') || '';
            el.title = currentTitle ? `${currentTitle} (${display})` : display;
        }
    }
}

/**
 * Schedule a task to run during browser idle time.
 * Falls back to setTimeout if requestIdleCallback is not available.
 * @param {Function} callback - Task to run
 * @param {number} timeout - Maximum time to wait before forcing execution (ms)
 */
function scheduleIdleTask(callback, timeout = 2000) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(callback, { timeout });
    } else {
        setTimeout(callback, 0);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // === CRITICAL PATH: Must complete before first paint ===
    
    // Set up core button event listeners immediately
    curlBtn.addEventListener('click', handleGenerateCurl);
    sendRequestBtn.addEventListener('click', handleSendRequest);
    cancelRequestBtn.addEventListener('click', handleCancelRequest);

    const mqttDisconnectBtn = document.getElementById('mqtt-disconnect-btn');
    if (mqttDisconnectBtn) {
        mqttDisconnectBtn.addEventListener('click', () => handleMqttCancel());
    }

    // Initialize request mode UI (needed for tab visibility)
    initGrpcUI();
    initRequestModeManager();

    // Import menu for OpenAPI, Postman, and cURL formats
    const importMenu = new ContextMenu();
    importCollectionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        importMenu.show(event, [
            {
                label: 'OpenAPI Collection',
                translationKey: 'import.openapi',
                icon: '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 3v6h6"></path>',
                onClick: importOpenApiFile
            },
            {
                label: 'Postman Collection',
                translationKey: 'import.postman_collection',
                icon: '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>',
                onClick: importPostmanCollection
            },
            {
                label: 'Postman Environment',
                translationKey: 'import.postman_environment',
                icon: '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>',
                onClick: importPostmanEnvironment
            },
            {
                label: 'cURL Command',
                translationKey: 'import.curl',
                icon: '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>',
                onClick: importCurl
            }
        ]);
    });

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.show();
        });
    }

    // Mock server button functionality
    const mockServerBtn = document.getElementById('mock-server-btn');
    if (mockServerBtn) {
        mockServerBtn.addEventListener('click', () => {
            mockServerDialog.show();
        });
    }

    // Collection Runner button functionality
    const runnerBtn = document.getElementById('runner-btn');
    if (runnerBtn) {
        runnerBtn.addEventListener('click', () => {
            if (app.workspaceTabController) {
                app.workspaceTabController.createRunnerTab();
            }
        });
    }

    // History toggle functionality
    const historyToggleBtn = document.getElementById('history-toggle-btn');
    const historySidebar = document.getElementById('history-sidebar');
    const historyResizerHandle = document.getElementById('history-resizer-handle');
    const closeHistoryBtn = document.getElementById('close-history-btn');

    const toggleHistory = (show) => {
        if (show) {
            historySidebar.classList.add('visible');
            historyResizerHandle.classList.add('visible');
            historyToggleBtn.classList.add('active');
        } else {
            historySidebar.classList.remove('visible');
            historyResizerHandle.classList.remove('visible');
            historyToggleBtn.classList.remove('active');
        }
    };

    if (historyToggleBtn && historySidebar && historyResizerHandle) {
        historyToggleBtn.addEventListener('click', () => {
            const isVisible = historySidebar.classList.contains('visible');
            toggleHistory(!isVisible);
        });
    }

    if (closeHistoryBtn) {
        closeHistoryBtn.addEventListener('click', () => {
            toggleHistory(false);
        });
    }

    // Cookie jar button — opens the cookie manager dialog
    const cookieJarBtn = document.getElementById('cookie-jar-btn');
    if (cookieJarBtn) {
        cookieJarBtn.addEventListener('click', () => {
            cookieController.openCookieManager();
        });
    }

    // Expose global references. Feature controllers (history, environment, script,
    // workspace tab) are exposed by the registry's `globals` map at boot; only non-feature
    // globals remain here.
    app.authManager = authManager;
    app.setUrlUpdating = setUrlUpdating;
    app.setGrpcMetadata = setGrpcMetadata;
    app.setGrpcTls = setGrpcTls;

    // Initialize environment selector (needed for environment switching)
    environmentSelector.initialize('environment-selector-container');

    // Parallelize independent IPC calls: i18n, environment controller, and cookie jar sync
    await Promise.all([
        i18n.init().then(() => { app.i18n = i18n; }),
        environmentController.initialize(),
        environmentService.getActiveEnvironment().then(activeEnv => {
            if (activeEnv) {
                cookieController.setActiveEnvironment(activeEnv.id, activeEnv.name);
            }
        }).catch(() => { /* non-blocking */ })
    ]);

    // Initialize body editors lazily - CodeMirror is heavy and most editors
    // aren't needed until the user interacts with a specific body mode.
    // Each lazy editor defers construction until first real access (setContent/getContent/etc.)
    let isInitializingEditor = false;
    let isInitializingGrpcEditor = false;

    function createLazyEditor(container, options, changeCallback) {
        let instance = null;
        const proxy = {
            _ensureInstance() {
                if (!instance && container) {
                    instance = new RequestBodyEditor(container, options);
                    if (changeCallback) {
                        instance.onChange(changeCallback);
                    }
                }
                return instance;
            },
            setContent(content) { this._ensureInstance()?.setContent(content); },
            getContent() { return this._ensureInstance()?.getContent() ?? ''; },
            clear() { this._ensureInstance()?.clear(); },
            onChange(cb) {
                changeCallback = cb;
                if (instance) { instance.onChange(cb); }
            },
            formatJSON() { return this._ensureInstance()?.formatJSON() ?? true; },
            focus() { this._ensureInstance()?.focus(); },
            destroy() { instance?.destroy(); instance = null; }
        };
        return proxy;
    }

    // JSON body editor (lazy)
    let requestBodyEditor = null;
    if (bodyEditorContainer) {
        requestBodyEditor = createLazyEditor(bodyEditorContainer, {}, (content) => {
            if (bodyInput) {
                bodyInput.value = content;
            }
            if (app.workspaceTabController &&
                !isInitializingEditor &&
                !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
        app.requestBodyEditor = requestBodyEditor;
    }

    // Plain-text body editor (lazy)
    if (bodyTextEditorContainer) {
        app.requestBodyTextEditor = createLazyEditor(
            bodyTextEditorContainer,
            { language: 'plain' },
            (_content) => {
                if (app.workspaceTabController &&
                    !app.workspaceTabController.isRestoringState) {
                    app.workspaceTabController.markCurrentTabModified();
                }
            }
        );
    }

    // gRPC body editor (lazy)
    let grpcBodyEditor = null;
    if (grpcBodyEditorContainer) {
        grpcBodyEditor = createLazyEditor(grpcBodyEditorContainer, {}, (content) => {
            if (grpcBodyInput) {
                grpcBodyInput.value = content;
            }
            if (app.workspaceTabController &&
                !isInitializingGrpcEditor &&
                !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
        app.grpcBodyEditor = grpcBodyEditor;
    }

    // Initialize workspace tabs (restores user's last state - critical for UX)
    // Must happen AFTER body editors are initialized so text/gRPC body content can be restored
    await workspaceTabController.initialize();

    // Sync JSON body editor with textarea content (restored by workspace tab initialization)
    // Use flag to prevent marking tab as modified during this sync
    if (requestBodyEditor && bodyInput && bodyInput.value) {
        isInitializingEditor = true;
        requestBodyEditor.setContent(bodyInput.value);
        // Use setTimeout to ensure flag is cleared after any async updates
        setTimeout(() => {
            isInitializingEditor = false;
        }, 0);
    }

    // Sync gRPC body editor with textarea content
    if (grpcBodyEditor && grpcBodyInput && grpcBodyInput.value) {
        isInitializingGrpcEditor = true;
        grpcBodyEditor.setContent(grpcBodyInput.value);
        setTimeout(() => {
            isInitializingGrpcEditor = false;
        }, 0);
    }

    // Initialize tab listeners AFTER workspace tabs are created
    initTabListeners();

    // Initialize script sub-tabs
    initializeScriptSubTabs();

    // Activate default response tab
    activateTab('response', 'response-body');

    document.addEventListener('languageChanged', (_event) => {
        // Any dynamic content that needs special handling can be refreshed here
    });

    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initializeBodyTracking();
    initResizer();
    initializeCopyHandler();
    initKeyboardShortcuts();
    applyShortcutHints();

    // Track changes to mark tabs as modified
    if (urlInput) {
        urlInput.addEventListener('input', () => {
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (bodyInput) {
        bodyInput.addEventListener('input', () => {
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (methodSelect) {
        methodSelect.addEventListener('change', () => {
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    activateTab('request', 'path-params');

    const pathParamsList = document.getElementById('path-params-list');
    const headersList = document.getElementById('headers-list');
    const _queryParamsList = document.getElementById('query-params-list');

    if (pathParamsList.children.length === 0) {addKeyValueRow(pathParamsList);}
    if (headersList.children.length === 0) {addKeyValueRow(headersList, 'Content-Type', 'application/json');}

    updateQueryParamsFromUrl();

    // === FIRST PAINT COMPLETE ===
    // The UI is now interactive. Defer non-critical initialization to idle time.

    // Load collections (can show loading state in sidebar)
    loadCollections();

    // === DEFERRED INITIALIZATION ===
    // These tasks run during browser idle time to avoid blocking the main thread

    // Tier 1: Initialize after first idle (needed for full functionality)
    scheduleIdleTask(async () => {
        // Initialize status bar
        const statusBar = new StatusBar(environmentService);
        statusBar.initialize();
        app.statusBar = statusBar;

        // Initialize history controller (needed for history sidebar)
        await historyController.init();

        // Initialize URL autocomplete from history
        if (urlInput) {
            const urlAutocomplete = new UrlAutocomplete(urlInput, historyController);
            urlAutocomplete.init();
        }
    }, 1000);

    // Tier 2: Lower priority initialization
    scheduleIdleTask(async () => {
        // Initialize mock server controller
        await mockServerController.initialize();

        // Initialize WebSocket handler
        await initWebSocketHandler();

        // Initialize SSE handler
        await initSseHandler();

        // Initialize MQTT handler
        await initMqttHandler();

        // Initialize gRPC streaming handler
        await initGrpcStreamHandler();

        // Check for and perform migration from old single-file store
        try {
            if (window.backendAPI?.collections?.needsMigration) {
                const needsMigration = await window.backendAPI.collections.needsMigration();
                if (needsMigration) {
                    updateStatusDisplay('Migrating collections to new format...', null);
                    const migratedCount = await window.backendAPI.collections.migrate();
                    if (migratedCount > 0) {
                        updateStatusDisplay(`Migrated ${migratedCount} collection(s) to new format`, null);
                    }
                }
            }
        } catch (error) {
            toast.error(`Migration check failed: ${error.message}`);
        }
    }, 2000);

    // Tier 3: Lowest priority (update check)
    scheduleIdleTask(() => {
        checkForUpdatesOnLaunch();
    }, 3000);
});

// Save current tab state before window closes
window.addEventListener('beforeunload', async (_e) => {
    try {
        const activeTabId = await workspaceTabService.getActiveTabId();
        if (activeTabId) {
            const currentState = await workspaceTabStateManager.captureCurrentState();
            await workspaceTabService.updateTab(activeTabId, currentState);
        }
    } catch (error) {
        void error;
    }
});

/**
 * Check for updates on application launch if the setting is enabled
 */
async function checkForUpdatesOnLaunch() {
    try {
        // Check if updater is available and setting is enabled
        if (!window.backendAPI?.updater?.check || !window.backendAPI?.updater?.getInstallInfo) {
            return;
        }

        // Check if auto-update is supported for this installation type
        const installInfo = await window.backendAPI.updater.getInstallInfo();
        if (!installInfo.autoUpdateSupported) {
            return;
        }

        // Check if the setting is enabled
        const settings = await window.backendAPI.settings.get();
        if (!settings.checkUpdatesOnLaunch) {
            return;
        }

        // Check for updates
        const update = await window.backendAPI.updater.check();
        if (update?.available) {
            const message = app.i18n?.t('settings.update_available', { version: update.version }) || `Update available: v${update.version}`;
            toast.info(message);
        }
    } catch (error) {
        // Silently ignore errors during startup update check
        void error;
    }
}
