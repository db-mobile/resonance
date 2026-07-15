/**
 * @fileoverview Main renderer process orchestrator for Resonance
 * @module renderer
 *
 * Initializes and coordinates all UI modules, controllers, services, and repositories.
 * Sets up event listeners, keyboard shortcuts, and manages the application lifecycle
 * in the renderer process.
 */

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
import { initGraphQLSubscriptionHandler } from './modules/graphqlSubscriptionHandler.js';
import { initSseHandler } from './modules/sseHandler.js';
import { initMqttHandler, handleMqttCancel } from './modules/mqttHandler.js';
import { initGrpcStreamHandler } from './modules/grpcStreamHandler.js';
import { loadCollections, importOpenApiFile, importPostmanCollection, importPostmanEnvironment, importCurl, initializeBodyTracking } from './modules/collectionManager.js';
import { ThemeManager } from './modules/themeManager.js';
import { SettingsModal } from './modules/ui/SettingsModal.js';
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
import { loadEditor, warmEditors } from './modules/editorLoader.js';
import { UrlAutocomplete } from './modules/ui/UrlAutocomplete.js';
import { toast } from './modules/ui/Toast.js';

const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const timeoutManager = new TimeoutManager();

app.invalidateApiHandlerSettingsCache = invalidateSettingsCache;
app.getApiHandlerSettingsCache = getSettingsCache;
app.invalidateApiHandlerEnvironmentCache = invalidateEnvironmentCache;

const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);

const secretStore = new SecretStore(window.backendAPI, {
    onFallback: () => toast.warning(
        'No OS keychain available — secrets are stored locally without encryption at rest.'
    )
});
app.secretStore = secretStore;

const collectionRepository = new CollectionRepository(window.backendAPI, secretStore);

const graphqlBodyManager = new GraphQLBodyManager({
    bodyInput,
    graphqlQueryEditor: document.getElementById('graphql-query-editor'),
    graphqlVariablesEditor: document.getElementById('graphql-variables-editor'),
    graphqlFormatBtn: document.getElementById('graphql-format-btn')
});
graphqlBodyManager.initialize();
setGraphQLBodyManager(graphqlBodyManager);
app.graphqlBodyManager = graphqlBodyManager;

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

const formBodyManager = new FormBodyManager();
formBodyManager.initialize();
app.formBodyManager = formBodyManager;

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
    keyboardShortcuts.init();

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
    
    curlBtn.addEventListener('click', handleGenerateCurl);
    sendRequestBtn.addEventListener('click', handleSendRequest);
    cancelRequestBtn.addEventListener('click', handleCancelRequest);

    const mqttDisconnectBtn = document.getElementById('mqtt-disconnect-btn');
    if (mqttDisconnectBtn) {
        mqttDisconnectBtn.addEventListener('click', () => handleMqttCancel());
    }

    initGrpcUI();
    initRequestModeManager();

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

    const primaryMenu = document.getElementById('primary-menu');
    if (primaryMenu) {
        document.addEventListener('click', (event) => {
            if (primaryMenu.open && !primaryMenu.contains(event.target)) {
                primaryMenu.open = false;
            }
        });
        primaryMenu.addEventListener('click', (event) => {
            if (event.target.closest('.menu-item')) {
                primaryMenu.open = false;
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && primaryMenu.open) {
                primaryMenu.open = false;
            }
        });
    }

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.show();
        });
    }

    const mockServerBtn = document.getElementById('mock-server-btn');
    if (mockServerBtn) {
        mockServerBtn.addEventListener('click', () => {
            mockServerDialog.show();
        });
    }

    const runnerBtn = document.getElementById('runner-btn');
    if (runnerBtn) {
        runnerBtn.addEventListener('click', () => {
            if (app.workspaceTabController) {
                app.workspaceTabController.createRunnerTab();
            }
        });
    }

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

    const cookieJarBtn = document.getElementById('cookie-jar-btn');
    if (cookieJarBtn) {
        cookieJarBtn.addEventListener('click', () => {
            cookieController.openCookieManager();
        });
    }

    // globals remain here.
    app.authManager = authManager;
    app.setUrlUpdating = setUrlUpdating;
    app.setGrpcMetadata = setGrpcMetadata;
    app.setGrpcTls = setGrpcTls;

    environmentSelector.initialize('environment-selector-container');

    await Promise.all([
        i18n.init().then(() => { app.i18n = i18n; }),
        environmentController.initialize(),
        environmentService.getActiveEnvironment().then(activeEnv => {
            if (activeEnv) {
                cookieController.setActiveEnvironment(activeEnv.id, activeEnv.name);
            }
        }).catch(() => { })
    ]);

    let isInitializingEditor = false;
    let isInitializingGrpcEditor = false;

    function createLazyEditor(container, options, changeCallback) {
        let instance = null;
        let loadStarted = false;
        let destroyed = false;
        let pendingContent = null;

        function ensure() {
            if (instance || destroyed || !container || loadStarted) { return; }
            loadStarted = true;
            loadEditor('requestBody').then((RequestBodyEditor) => {
                if (destroyed) { return; }
                instance = new RequestBodyEditor(container, options);
                if (pendingContent !== null) {
                    instance.setContent(pendingContent);
                    pendingContent = null;
                }
                if (changeCallback) {
                    instance.onChange(changeCallback);
                }
            });
        }

        return {
            setContent(content) {
                if (instance) { instance.setContent(content); }
                else { pendingContent = content; ensure(); }
            },
            getContent() { return instance ? instance.getContent() : (pendingContent ?? ''); },
            clear() {
                if (instance) { instance.clear(); }
                else { pendingContent = ''; }
            },
            onChange(cb) {
                changeCallback = cb;
                if (instance) { instance.onChange(cb); }
            },
            formatJSON() { return instance ? instance.formatJSON() : true; },
            focus() {
                if (instance) { instance.focus(); }
                else { ensure(); }
            },
            ensure() { ensure(); },
            destroy() { instance?.destroy(); instance = null; destroyed = true; pendingContent = null; }
        };
    }

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

    await workspaceTabController.initialize();

    if (requestBodyEditor && bodyInput && bodyInput.value) {
        isInitializingEditor = true;
        requestBodyEditor.setContent(bodyInput.value);
        setTimeout(() => {
            isInitializingEditor = false;
        }, 0);
    }

    if (grpcBodyEditor && grpcBodyInput && grpcBodyInput.value) {
        isInitializingGrpcEditor = true;
        grpcBodyEditor.setContent(grpcBodyInput.value);
        setTimeout(() => {
            isInitializingGrpcEditor = false;
        }, 0);
    }

    initTabListeners();

    initializeScriptSubTabs();

    activateTab('response', 'response-body');

    document.addEventListener('languageChanged', (_event) => {
    });

    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initializeBodyTracking();
    initResizer();
    initializeCopyHandler();
    initKeyboardShortcuts();
    applyShortcutHints();

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

    loadCollections();

    scheduleIdleTask(() => {
        warmEditors();
    }, 500);

    scheduleIdleTask(async () => {
        const statusBar = new StatusBar(environmentService);
        statusBar.initialize();
        app.statusBar = statusBar;

        await historyController.init();

        if (urlInput) {
            const urlAutocomplete = new UrlAutocomplete(urlInput, historyController);
            urlAutocomplete.init();
        }
    }, 1000);

    scheduleIdleTask(async () => {
        await mockServerController.initialize();

        await initWebSocketHandler();

        await initGraphQLSubscriptionHandler();

        await initSseHandler();

        await initMqttHandler();

        await initGrpcStreamHandler();

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

    scheduleIdleTask(() => {
        checkForUpdatesOnLaunch();
    }, 3000);
});

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
        if (!window.backendAPI?.updater?.check || !window.backendAPI?.updater?.getInstallInfo) {
            return;
        }

        const installInfo = await window.backendAPI.updater.getInstallInfo();
        if (!installInfo.autoUpdateSupported) {
            return;
        }

        const settings = await window.backendAPI.settings.get();
        if (!settings.checkUpdatesOnLaunch) {
            return;
        }

        const update = await window.backendAPI.updater.check();
        if (update?.available) {
            const message = app.i18n?.t('settings.update_available', { version: update.version }) || `Update available: v${update.version}`;
            toast.info(message);
        }
    } catch (error) {
        void error;
    }
}
