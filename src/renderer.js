/**
 * @fileoverview Main renderer process orchestrator for Resonance
 * @module renderer
 *
 * Initializes and coordinates all UI modules, controllers, services, and repositories.
 * Sets up event listeners, keyboard shortcuts, and manages the application lifecycle
 * in the renderer process.
 */

// Import ipcBridge first to set up window.backendAPI before any other modules
import './modules/ipcBridge.js';

import { sendRequestBtn, cancelRequestBtn, curlBtn, importCollectionBtn, urlInput, methodSelect, bodyInput, bodyEditorContainer, pathParamsList, queryParamsList, headersList, authTypeSelect, responseBodyContainer, statusDisplay, responseHeadersDisplay, responseCookiesDisplay, grpcTargetInput, grpcServiceSelect, grpcMethodSelect, grpcBodyInput, grpcBodyEditorContainer } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl, setUrlUpdating } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { initializeScriptSubTabs } from './modules/scriptSubTabs.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest, handleCancelRequest, handleGenerateCurl, setGraphQLBodyManager, invalidateSettingsCache, getSettingsCache, invalidateEnvironmentCache } from './modules/apiHandler.js';
import { GraphQLBodyManager } from './modules/graphqlBodyManager.js';
import { initGrpcUI, setGrpcMetadata, setGrpcTls } from './modules/grpcHandler.js';
import { initRequestModeManager } from './modules/requestModeManager.js';
import { initWebSocketHandler } from './modules/websocketHandler.js';
import { loadCollections, importOpenApiFile, importPostmanCollection, importPostmanEnvironment, importCurl, initializeBodyTracking } from './modules/collectionManager.js';
import { ThemeManager, SettingsModal } from './modules/themeManager.js';
import { HttpVersionManager } from './modules/httpVersionManager.js';
import { TimeoutManager } from './modules/timeoutManager.js';
import { initResizer } from './modules/resizer.js';
import { i18n } from './i18n/I18nManager.js';
import { authManager } from './modules/authManager.js';
import { initializeCopyHandler } from './modules/copyHandler.js';
import { HistoryController } from './modules/controllers/HistoryController.js';
import { EnvironmentController } from './modules/controllers/EnvironmentController.js';
import { EnvironmentRepository } from './modules/storage/EnvironmentRepository.js';
import { EnvironmentService } from './modules/services/EnvironmentService.js';
import { EnvironmentManager } from './modules/ui/EnvironmentManager.js';
import { EnvironmentSelector } from './modules/ui/EnvironmentSelector.js';
import { StatusBar } from './modules/ui/StatusBar.js';
import { ContextMenu } from './modules/ui/ContextMenu.js';
import { ProxyController } from './modules/controllers/ProxyController.js';
import { ProxyRepository } from './modules/storage/ProxyRepository.js';
import { ProxyService } from './modules/services/ProxyService.js';
import { StatusDisplayAdapter } from './modules/interfaces/IStatusDisplay.js';
import { keyboardShortcuts } from './modules/keyboardShortcuts.js';
import { WorkspaceTabRepository } from './modules/storage/WorkspaceTabRepository.js';
import { WorkspaceTabService } from './modules/services/WorkspaceTabService.js';
import { WorkspaceTabBar } from './modules/ui/WorkspaceTabBar.js';
import { WorkspaceTabController } from './modules/controllers/WorkspaceTabController.js';
import { WorkspaceTabStateManager } from './modules/WorkspaceTabStateManager.js';
import { ResponseContainerManager } from './modules/ResponseContainerManager.js';
import { ScriptController } from './modules/controllers/ScriptController.js';
import { ScriptService } from './modules/services/ScriptService.js';
import { ScriptRepository } from './modules/storage/ScriptRepository.js';
import { InlineScriptManager } from './modules/ui/InlineScriptManager.js';
import { ScriptConsolePanel } from './modules/ui/ScriptConsolePanel.js';
import { MockServerRepository } from './modules/storage/MockServerRepository.js';
import { MockServerService } from './modules/services/MockServerService.js';
import { MockServerController } from './modules/controllers/MockServerController.js';
import { MockServerDialog } from './modules/ui/MockServerDialog.js';
import { CollectionRepository } from './modules/storage/CollectionRepository.js';
import { RequestBodyEditor } from './modules/requestBodyEditor.bundle.js';
import { PreviewRepository } from './modules/storage/PreviewRepository.js';
import { UrlAutocomplete } from './modules/ui/UrlAutocomplete.js';
import { toast } from './modules/ui/Toast.js';
import { CookieRepository } from './modules/storage/CookieRepository.js';
import { CookieJarService } from './modules/services/CookieJarService.js';
import { CookieController } from './modules/controllers/CookieController.js';
import { CookieManagerDialog } from './modules/ui/CookieManagerDialog.js';
import { SchemaController } from './modules/controllers/SchemaController.js';

const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const timeoutManager = new TimeoutManager();

// Expose settings cache invalidation so themeManager/httpVersionManager/timeoutManager
// can bust it when the user saves new settings
window.invalidateApiHandlerSettingsCache = invalidateSettingsCache;
window.getApiHandlerSettingsCache = getSettingsCache;
window.invalidateApiHandlerEnvironmentCache = invalidateEnvironmentCache;

// Initialize shared status display adapter
const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);

// Initialize proxy system
const proxyRepository = new ProxyRepository(window.backendAPI);
const proxyService = new ProxyService(proxyRepository, statusDisplayAdapter);
const proxyController = new ProxyController(proxyService);

// Initialize environment system
const environmentRepository = new EnvironmentRepository(window.backendAPI);
const environmentService = new EnvironmentService(environmentRepository, statusDisplayAdapter);
const environmentManager = new EnvironmentManager(environmentService);

// Create environment controller first
// eslint-disable-next-line prefer-const
let environmentController;

// Create environment selector with callbacks that will use the controller
const environmentSelector = new EnvironmentSelector(
    environmentService,
    (envId) => environmentController.switchEnvironment(envId),
    () => environmentController.openEnvironmentManager()
);

// Now create the controller
environmentController = new EnvironmentController(
    environmentService,
    environmentManager,
    environmentSelector
);

// Initialize cookie jar system
const cookieRepository = new CookieRepository(window.backendAPI);
const cookieJarService = new CookieJarService(cookieRepository);
const cookieManagerDialog = new CookieManagerDialog(cookieJarService);
const cookieController = new CookieController(cookieJarService, cookieManagerDialog);
cookieController.initialize();
window.cookieController = cookieController;

// Sync cookie jar environment when active environment changes
environmentService.addChangeListener((event) => {
    if (event.type === 'environment-switched') {
        cookieController.setActiveEnvironment(event.environmentId, event.environmentName);
    }
});

// Initialize script system
const scriptRepository = new ScriptRepository(window.backendAPI);
const scriptService = new ScriptService(
    scriptRepository,
    environmentService,
    statusDisplayAdapter
);
const inlineScriptManager = new InlineScriptManager();
// Initialize script manager event listeners
inlineScriptManager.initialize();
// Expose globally for workspace tab restoration
window.inlineScriptManager = inlineScriptManager;
// ScriptConsolePanel will be initialized per workspace tab, so pass null for now
const scriptConsolePanel = new ScriptConsolePanel(null);
const scriptController = new ScriptController(
    scriptService,
    inlineScriptManager,
    scriptConsolePanel
);

// Initialize GraphQL body manager
const graphqlBodyManager = new GraphQLBodyManager({
    bodyInput,
    graphqlQueryEditor: document.getElementById('graphql-query-editor'),
    graphqlVariablesEditor: document.getElementById('graphql-variables-editor'),
    graphqlFormatBtn: document.getElementById('graphql-format-btn')
});
graphqlBodyManager.initialize();

// Make available to apiHandler
setGraphQLBodyManager(graphqlBodyManager);

// Make available globally for workspace tab state manager
window.graphqlBodyManager = graphqlBodyManager;

// Initialize settings modal with all managers
const settingsModal = new SettingsModal(themeManager, i18n, httpVersionManager, timeoutManager, proxyController);

// Initialize mock server system
const collectionRepository = new CollectionRepository(window.backendAPI);
const mockServerRepository = new MockServerRepository(window.backendAPI);
const mockServerService = new MockServerService(mockServerRepository, statusDisplayAdapter);
const mockServerController = new MockServerController(mockServerService, collectionRepository);
const mockServerDialog = new MockServerDialog(mockServerController);

// Initialize schema validation system
const schemaController = new SchemaController({
    repository: collectionRepository,
    statusDisplay: statusDisplayAdapter
});
window.schemaController = schemaController;

// Initialize history controller
const historyController = new HistoryController(window.backendAPI);

// Initialize preview repository
const previewRepository = new PreviewRepository(window.backendAPI);

// Initialize response container manager for multiple workspace tabs
const responseContainerManager = new ResponseContainerManager(previewRepository);
window.responseContainerManager = responseContainerManager;

// Initialize workspace tab system
const workspaceTabRepository = new WorkspaceTabRepository(window.backendAPI);
const workspaceTabService = new WorkspaceTabService(workspaceTabRepository, statusDisplayAdapter);
const workspaceTabBar = new WorkspaceTabBar('workspace-tab-bar-container');
const workspaceTabStateManager = new WorkspaceTabStateManager({
    urlInput,
    methodSelect,
    bodyInput,
    pathParamsList,
    queryParamsList,
    headersList,
    authTypeSelect,
    responseBodyContainer,
    statusDisplay,
    responseHeadersDisplay,
    responseCookiesDisplay,
    graphqlBodyManager,
    grpcTargetInput,
    grpcServiceSelect,
    grpcMethodSelect,
    grpcBodyInput
});
const workspaceTabController = new WorkspaceTabController(
    workspaceTabService,
    workspaceTabBar,
    workspaceTabStateManager,
    responseContainerManager
);

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
            if (window.currentEndpoint) {
                const { saveAllRequestModifications } = await import('./modules/collectionManager.js');
                await saveAllRequestModifications(
                    window.currentEndpoint.collectionId,
                    window.currentEndpoint.endpointId
                );
                if (window.workspaceTabController) {
                    await window.workspaceTabController.markCurrentTabUnmodified();
                }
            } else if (window.workspaceTabController) {
                // No endpoint loaded - show "Save to Collection" dialog
                const { saveRequestToCollection } = await import('./modules/collectionManager.js');
                const activeTab = await window.workspaceTabController.service.getActiveTab();
                if (activeTab && activeTab.type !== 'runner') {
                    const state = await window.workspaceTabController.stateManager.captureCurrentState();
                    const requestData = {
                        name: activeTab.name,
                        ...state.request
                    };
                    const result = await saveRequestToCollection(requestData);
                    if (result) {
                        // Update current endpoint and tab
                        window.currentEndpoint = {
                            collectionId: result.collectionId,
                            endpointId: result.endpointId
                        };
                        await window.workspaceTabController.service.updateTab(activeTab.id, {
                            name: result.name,
                            endpoint: {
                                collectionId: result.collectionId,
                                endpointId: result.endpointId,
                                protocol: state.request.protocol || 'http'
                            }
                        });
                        window.workspaceTabController.tabBar.updateTab(activeTab.id, { name: result.name });
                        await window.workspaceTabController.markCurrentTabUnmodified();
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
            if (window.cookieController) {
                window.cookieController.openCookieManager();
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
            if (window.workspaceTabController) {
                window.workspaceTabController.createRunnerTab();
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

    // Initialize i18n (needed for UI text)
    await i18n.init();

    // Expose global references
    window.i18n = i18n;
    window.authManager = authManager;
    window.historyController = historyController;
    window.environmentController = environmentController;
    window.workspaceTabController = workspaceTabController;
    window.scriptController = scriptController;
    window.setUrlUpdating = setUrlUpdating;
    window.setGrpcMetadata = setGrpcMetadata;
    window.setGrpcTls = setGrpcTls;

    // Initialize environment selector (needed for environment switching)
    environmentSelector.initialize('environment-selector-container');

    // Initialize environment controller and load active environment
    await environmentController.initialize();

    // Sync cookie jar with active environment on startup
    try {
        const activeEnv = await environmentService.getActiveEnvironment();
        if (activeEnv) {
            cookieController.setActiveEnvironment(activeEnv.id, activeEnv.name);
        }
    } catch (_e) { /* non-blocking */ }

    // Initialize workspace tabs (restores user's last state - critical for UX)
    await workspaceTabController.initialize();

    // Initialize request body editor
    let requestBodyEditor = null;
    let isInitializingEditor = false; // Flag to prevent marking tab as modified during init
    if (bodyEditorContainer) {
        requestBodyEditor = new RequestBodyEditor(bodyEditorContainer);

        // Make globally available
        window.requestBodyEditor = requestBodyEditor;

        // Set up change callback to keep textarea in sync (for backward compatibility)
        requestBodyEditor.onChange((content) => {
            if (bodyInput) {
                bodyInput.value = content;
            }
            // Mark workspace tab as modified (but not during initialization or state restoration)
            if (window.workspaceTabController &&
                !isInitializingEditor &&
                !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });

        // Sync editor with textarea content (restored by workspace tab initialization)
        // Use flag to prevent marking tab as modified during this sync
        if (bodyInput && bodyInput.value) {
            isInitializingEditor = true;
            requestBodyEditor.setContent(bodyInput.value);
            // Use setTimeout to ensure flag is cleared after any async updates
            setTimeout(() => {
                isInitializingEditor = false;
            }, 0);
        }
    }

    // Initialize gRPC body editor
    let grpcBodyEditor = null;
    let isInitializingGrpcEditor = false;
    if (grpcBodyEditorContainer) {
        grpcBodyEditor = new RequestBodyEditor(grpcBodyEditorContainer);
        window.grpcBodyEditor = grpcBodyEditor;

        grpcBodyEditor.onChange((content) => {
            if (grpcBodyInput) {
                grpcBodyInput.value = content;
            }
            if (window.workspaceTabController &&
                !isInitializingGrpcEditor &&
                !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });

        if (grpcBodyInput && grpcBodyInput.value) {
            isInitializingGrpcEditor = true;
            grpcBodyEditor.setContent(grpcBodyInput.value);
            setTimeout(() => {
                isInitializingGrpcEditor = false;
            }, 0);
        }
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
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (bodyInput) {
        bodyInput.addEventListener('input', () => {
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (methodSelect) {
        methodSelect.addEventListener('change', () => {
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
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
            const message = window.i18n?.t('settings.update_available', { version: update.version }) || `Update available: v${update.version}`;
            toast.info(message);
        }
    } catch (error) {
        // Silently ignore errors during startup update check
        void error;
    }
}
