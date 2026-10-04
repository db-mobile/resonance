/**
 * @fileoverview Main renderer process orchestrator for Resonance
 * @module renderer
 */

import { getCurrentEndpoint, setCurrentEndpoint } from './modules/state/currentEndpoint.js';
import { app } from './modules/appContext.js';
import './modules/ipcBridge.js';

import { sendRequestBtn, cancelRequestBtn, curlBtn, importCollectionBtn, urlInput, methodSelect, bodyInput, bodyEditorContainer, bodyTextEditorContainer, grpcBodyInput, grpcBodyEditorContainer } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { initializeScriptSubTabs } from './modules/scriptSubTabs.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest, handleCancelRequest, handleGenerateCurl, invalidateEnvironmentCache } from './modules/apiHandler.js';
import { getSettingsCache } from './modules/state/settingsCache.js';
import { markTabModified } from './modules/state/tabModified.js';
import { applyGrpcState, captureGrpcState, initGrpcUI } from './modules/grpcHandler.js';
import { initRequestModeManager } from './modules/requestModeManager.js';
import { initWebSocketHandler } from './modules/websocketHandler.js';
import { initGraphQLSubscriptionHandler } from './modules/graphqlSubscriptionHandler.js';
import { initSseHandler } from './modules/sseHandler.js';
import { initMqttHandler, handleMqttCancel } from './modules/mqttHandler.js';
import { initGrpcStreamHandler } from './modules/grpcStreamHandler.js';
import { loadCollections, importCollectionFile, importPostmanEnvironment, importCurl, openExistingCollection, initializeBodyTracking, saveAllRequestModifications, saveRequestToCollection } from './modules/collectionManager.js';
import { initResizer } from './modules/resizer.js';
import { i18n } from './i18n/I18nManager.js';
import { authManager } from './modules/authManager.js';
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
import { graphqlBodyFeature } from './modules/graphqlBody.feature.js';
import { formBodyFeature } from './modules/formBody.feature.js';
import { settingsFeature } from './modules/settings.feature.js';
import { StatusDisplayAdapter } from './modules/interfaces/IStatusDisplay.js';
import { keyboardShortcuts } from './modules/keyboardShortcuts.js';
import { CollectionRepository } from './modules/storage/CollectionRepository.js';
import { loadEditor, warmEditors } from './modules/editorLoader.js';
import { UrlAutocomplete } from './modules/ui/UrlAutocomplete.js';
import { toast } from './modules/ui/Toast.js';
import { showDataMigrationIssues } from './modules/ui/MigrationNoticeDialog.js';

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
featureRegistry
    .register(graphqlBodyFeature)
    .register(formBodyFeature)
    .register(environmentFeature)
    .register(proxyFeature)
    .register(certificateFeature)
    .register(settingsFeature)
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
const cookieController = featureRegistry.get('cookie').controller;
const mockServer = featureRegistry.get('mockServer');
const mockServerDialog = mockServer.dialog;
const historyController = featureRegistry.get('history').controller;
const workspaceTab = featureRegistry.get('workspaceTab');
const workspaceTabController = workspaceTab.controller;
const workspaceTabService = workspaceTab.service;
const workspaceTabStateManager = workspaceTab.stateManager;
const settingsModal = featureRegistry.get('settings').modal;
const { layoutManager } = featureRegistry.get('settings');

/** @returns {Promise<void>} */
async function handleSaveShortcut() {
    const controller = app.workspaceTabController;
    const activeTab = controller ? await controller.service.getActiveTab() : null;

    if (activeTab && activeTab.type === 'runner') {
        return;
    }

    const tabEndpoint = activeTab?.endpoint?.collectionId && activeTab?.endpoint?.endpointId
        ? activeTab.endpoint
        : null;
    const endpoint = tabEndpoint || getCurrentEndpoint();

    try {
        if (endpoint) {
            await saveAllRequestModifications(endpoint.collectionId, endpoint.endpointId);

            if (controller) {
                await controller.markCurrentTabUnmodified();
            }
            toast.success(activeTab?.name ? `Saved "${activeTab.name}"` : 'Request saved');
            return;
        }

        if (!controller || !activeTab) {
            return;
        }

        const state = await controller.stateManager.captureCurrentState();
        const requestData = {
            name: activeTab.name,
            ...state.request
        };

        const saved = await saveRequestToCollection(requestData);
        if (!saved) {
            return;
        }

        setCurrentEndpoint({
            collectionId: saved.collectionId,
            endpointId: saved.endpointId
        });
        await controller.service.updateTab(activeTab.id, {
            name: saved.name,
            endpoint: {
                collectionId: saved.collectionId,
                endpointId: saved.endpointId,
                protocol: state.request.protocol || 'http'
            }
        });
        controller.tabBar.updateTab(activeTab.id, { name: saved.name });
        await controller.markCurrentTabUnmodified();

        toast.success(saved.collectionName
            ? `Saved "${saved.name}" to ${saved.collectionName}`
            : `Saved "${saved.name}"`);
    } catch (error) {
        toast.error(`Save failed: ${error.message || String(error)}`);
    }
}

/**
 * @param {boolean} [show]
 * @returns {void}
 */
function setHistoryVisible(show) {
    const historySidebar = document.getElementById('history-sidebar');
    const historyResizerHandle = document.getElementById('history-resizer-handle');
    const historyToggleBtn = document.getElementById('history-toggle-btn');
    if (!historySidebar || !historyResizerHandle) {
        return;
    }
    const visible = show ?? !historySidebar.classList.contains('visible');
    historySidebar.classList.toggle('visible', visible);
    historyResizerHandle.classList.toggle('visible', visible);
    historyToggleBtn?.classList.toggle('active', visible);
}

/** @param {number} delta */
async function cycleWorkspaceTab(delta) {
    if (!workspaceTabController) {
        return;
    }
    const tabs = await workspaceTabController.service.getAllTabs();
    const activeTabId = await workspaceTabController.service.getActiveTabId();
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
    await workspaceTabController.switchTab(tabs[nextIndex].id);
}

/** @param {number} position */
async function switchToWorkspaceTab(position) {
    if (!workspaceTabController) {
        return;
    }
    const tabs = await workspaceTabController.service.getAllTabs();
    if (tabs.length >= position) {
        await workspaceTabController.switchTab(tabs[position - 1].id);
    }
}

const REQUEST_TAB_SHORTCUTS = [
    { tab: 'path-params', label: 'Path Params' },
    { tab: 'query-params', label: 'Query Params' },
    { tab: 'headers', label: 'Headers' },
    { tab: 'authorization', label: 'Authorization' },
    { tab: 'body', label: 'Body' },
    { tab: 'scripts', label: 'Scripts' }
];

const SHORTCUTS = [
    {
        key: 'Enter', ctrl: true, category: 'Request', description: 'Send request', hintTarget: 'send-request-btn',
        handler: () => {
            if (sendRequestBtn && !sendRequestBtn.disabled) {
                handleSendRequest();
            }
        }
    },
    {
        key: 'KeyS', ctrl: true, category: 'Request', description: 'Save request',
        handler: () => handleSaveShortcut()
    },
    {
        key: 'Escape', category: 'Request', description: 'Cancel request', hintTarget: 'cancel-request-btn',
        handler: () => {
            if (cancelRequestBtn && !cancelRequestBtn.disabled && cancelRequestBtn.style.display !== 'none') {
                handleCancelRequest();
            }
        }
    },
    {
        key: 'KeyL', ctrl: true, category: 'Navigation', description: 'Focus URL bar',
        handler: () => {
            if (urlInput) {
                urlInput.focus();
                urlInput.select();
            }
        }
    },
    {
        key: 'KeyH', ctrl: true, category: 'Navigation', description: 'Toggle history sidebar', hintTarget: 'history-toggle-btn',
        handler: () => setHistoryVisible()
    },
    {
        key: 'KeyJ', ctrl: true, category: 'Navigation', description: 'Open cookie jar', hintTarget: 'cookie-jar-btn',
        handler: () => {
            if (app.cookieController) {
                app.cookieController.openCookieManager();
            }
        }
    },
    {
        key: 'KeyK', ctrl: true, category: 'Actions', description: 'Generate cURL command', hintTarget: 'curl-btn',
        handler: () => {
            if (curlBtn) {
                handleGenerateCurl();
            }
        }
    },
    {
        key: 'KeyO', ctrl: true, category: 'Actions', description: 'Import collection file', hintTarget: 'import-collection-btn',
        handler: () => {
            if (importCollectionBtn) {
                importCollectionFile();
            }
        }
    },
    {
        key: 'KeyE', ctrl: true, category: 'Actions', description: 'Open environment manager',
        handler: () => {
            if (environmentController) {
                environmentController.openEnvironmentManager();
            }
        }
    },
    {
        key: 'Comma', ctrl: true, category: 'Settings', description: 'Open settings', hintTarget: 'settings-btn',
        handler: () => {
            if (settingsModal) {
                settingsModal.show();
            }
        }
    },
    {
        key: 'Backslash', ctrl: true, category: 'View', description: 'Toggle side-by-side layout',
        handler: () => layoutManager.toggle()
    },
    {
        key: 'Slash', ctrl: true, category: 'Help', description: 'Show keyboard shortcuts',
        handler: () => keyboardShortcuts.showHelp()
    }
];

const WORKSPACE_TAB_SHORTCUTS = [
    {
        key: 'KeyT', ctrl: true, category: 'Workspace Tabs', description: 'New workspace tab',
        handler: () => {
            if (workspaceTabController) {
                workspaceTabController.createNewTab();
            }
        }
    },
    {
        key: 'KeyW', ctrl: true, category: 'Workspace Tabs', description: 'Close current tab',
        handler: async () => {
            if (workspaceTabController) {
                const activeTabId = await workspaceTabController.service.getActiveTabId();
                if (activeTabId) {
                    await workspaceTabController.closeTab(activeTabId);
                }
            }
        }
    },
    {
        key: 'Tab', ctrl: true, category: 'Workspace Tabs', description: 'Switch to next tab',
        handler: () => cycleWorkspaceTab(1)
    },
    {
        key: 'Tab', ctrl: true, shift: true, category: 'Workspace Tabs', description: 'Switch to previous tab',
        handler: () => cycleWorkspaceTab(-1)
    }
];

function initKeyboardShortcuts() {
    keyboardShortcuts.init();

    for (const { key, hintTarget: _hintTarget, ...options } of SHORTCUTS) {
        keyboardShortcuts.register(key, options);
    }

    for (let i = 1; i <= 9; i++) {
        keyboardShortcuts.register(`Digit${i}`, {
            ctrl: true,
            handler: () => switchToWorkspaceTab(i),
            description: `Switch to workspace tab ${i}`,
            category: 'Workspace Tabs'
        });
    }

    REQUEST_TAB_SHORTCUTS.forEach(({ tab, label }, index) => {
        keyboardShortcuts.register(`Digit${index + 1}`, {
            alt: true,
            handler: () => activateTab('request', tab),
            description: `Switch to ${label} tab`,
            category: 'Request Tabs'
        });
    });

    for (const { key, ...options } of WORKSPACE_TAB_SHORTCUTS) {
        keyboardShortcuts.register(key, options);
    }

    const keyboardShortcutsBtn = document.getElementById('keyboard-shortcuts-btn');
    if (keyboardShortcutsBtn) {
        keyboardShortcutsBtn.addEventListener('click', () => keyboardShortcuts.showHelp());
    }
}

function applyShortcutHints() {
    for (const { hintTarget, key, ctrl = false } of SHORTCUTS) {
        const el = hintTarget ? document.getElementById(hintTarget) : null;
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
 * @param {HTMLElement|null} container
 * @param {Object} options
 * @param {((content: string) => void)|null} changeCallback
 * @returns {Object}
 */
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
        formatJSONWithFeedback() { instance?.formatJSONWithFeedback(); },
        focus() {
            if (instance) { instance.focus(); }
            else { ensure(); }
        },
        ensure() { ensure(); },
        destroy() { instance?.destroy(); instance = null; destroyed = true; pendingContent = null; }
    };
}

/**
 * @param {Object|null} editor
 * @param {HTMLTextAreaElement|null} input
 * @param {(flag: boolean) => void} setFlag
 * @returns {void}
 */
function seedEditor(editor, input, setFlag) {
    if (!editor || !input || !input.value) {
        return;
    }
    setFlag(true);
    editor.setContent(input.value);
    setTimeout(() => {
        setFlag(false);
    }, 0);
}

/**
 * @param {Function} callback
 * @param {number} timeout
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
                label: 'Collection File',
                translationKey: 'import.collection',
                icon: '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 3v6h6"></path>',
                onClick: importCollectionFile
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
            },
            {
                label: 'Existing Folder',
                translationKey: 'import.open_existing',
                icon: '<path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"></path>',
                onClick: openExistingCollection
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

    const layoutToggleBtn = document.getElementById('layout-toggle-btn');
    if (layoutToggleBtn) {
        const syncLayoutToggle = (layout) => {
            layoutToggleBtn.setAttribute('aria-checked', String(layout === 'side-by-side'));
        };
        syncLayoutToggle(layoutManager.getLayout());
        layoutManager.addChangeListener(syncLayoutToggle);
        layoutToggleBtn.addEventListener('click', () => layoutManager.toggle());
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

    document.getElementById('history-toggle-btn')?.addEventListener('click', () => setHistoryVisible());
    document.getElementById('close-history-btn')?.addEventListener('click', () => setHistoryVisible(false));

    const cookieJarBtn = document.getElementById('cookie-jar-btn');
    if (cookieJarBtn) {
        cookieJarBtn.addEventListener('click', () => {
            cookieController.openCookieManager();
        });
    }

    app.authManager = authManager;
    authManager.getInheritedAuthInfo = async () => {
        const controller = app.collectionController;
        const current = getCurrentEndpoint();
        if (!controller || !current?.collectionId) {
            return null;
        }
        const [collection, folder] = await Promise.all([
            controller.repository.getById(current.collectionId),
            controller.repository.findFolderForEndpoint(current.collectionId, current.endpointId)
        ]);
        const folderHasAuth = Boolean(folder?.authConfig?.type && folder.authConfig.type !== 'inherit');
        const authConfig = folderHasAuth
            ? await controller.repository.getFolderAuthConfig(current.collectionId, folder.id)
            : await controller.repository.getCollectionAuthConfig(current.collectionId);
        return {
            collectionId: current.collectionId,
            collectionName: collection?.name || '',
            folderId: folderHasAuth ? folder.id : null,
            folderName: folderHasAuth ? folder.name : '',
            authType: authConfig?.type || 'none'
        };
    };
    authManager.onOpenCollectionAuth = async (collectionId, folderId = null) => {
        const controller = app.collectionController;
        if (!controller) {
            return;
        }
        const collection = await controller.repository.getById(collectionId);
        if (!collection) {
            return;
        }
        const folder = folderId
            ? (collection.folders || []).find((f) => f.id === folderId)
            : null;
        if (folder) {
            await controller.handleFolderAuth(collection, folder);
        } else {
            await controller.handleCollectionAuth(collection);
        }
    };
    app.captureGrpcState = captureGrpcState;
    app.applyGrpcState = applyGrpcState;

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

    let requestBodyEditor = null;
    if (bodyEditorContainer) {
        requestBodyEditor = createLazyEditor(bodyEditorContainer, {}, (content) => {
            if (bodyInput) {
                bodyInput.value = content;
            }
            if (!isInitializingEditor) {
                markTabModified();
            }
        });
        app.requestBodyEditor = requestBodyEditor;
    }

    if (bodyTextEditorContainer) {
        app.requestBodyTextEditor = createLazyEditor(
            bodyTextEditorContainer,
            { language: 'plain' },
            (_content) => {
                markTabModified();
            }
        );
    }

    let grpcBodyEditor = null;
    if (grpcBodyEditorContainer) {
        grpcBodyEditor = createLazyEditor(grpcBodyEditorContainer, {}, (content) => {
            if (grpcBodyInput) {
                grpcBodyInput.value = content;
            }
            if (!isInitializingGrpcEditor) {
                markTabModified();
            }
        });
        app.grpcBodyEditor = grpcBodyEditor;
    }

    await workspaceTabController.initialize();

    seedEditor(requestBodyEditor, bodyInput, (flag) => {
        isInitializingEditor = flag;
    });
    seedEditor(grpcBodyEditor, grpcBodyInput, (flag) => {
        isInitializingGrpcEditor = flag;
    });

    initTabListeners();

    initializeScriptSubTabs();

    activateTab('response', 'response-body');

    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initializeBodyTracking();
    initResizer(layoutManager);
    initKeyboardShortcuts();
    applyShortcutHints();

    if (urlInput) {
        urlInput.addEventListener('input', () => {
            markTabModified();
        });
    }

    if (bodyInput) {
        bodyInput.addEventListener('input', () => {
            markTabModified();
        });
    }

    if (methodSelect) {
        methodSelect.addEventListener('change', () => {
            markTabModified();
        });
    }

    const pathParamsList = document.getElementById('path-params-list');
    const headersList = document.getElementById('headers-list');

    if (pathParamsList.children.length === 0) {addKeyValueRow(pathParamsList);}
    if (headersList.children.length === 0) {addKeyValueRow(headersList, 'Content-Type', 'application/json');}

    updateQueryParamsFromUrl();

    loadCollections();

    scheduleIdleTask(() => {
        warmEditors();
    }, 500);

    scheduleIdleTask(async () => {
        const statusBar = new StatusBar({
            mockServer,
            proxyService: featureRegistry.get('proxy').service,
            secretStore,
            settingsModal,
            httpVersionManager: featureRegistry.get('settings').httpVersionManager
        });
        statusBar.initialize();
        app.statusBar = statusBar;

        await historyController.init();

        if (urlInput) {
            const urlAutocomplete = new UrlAutocomplete(urlInput, historyController);
            urlAutocomplete.init();
        }
    }, 1000);

    scheduleIdleTask(async () => {
        await initWebSocketHandler();

        await initGraphQLSubscriptionHandler();

        await initSseHandler();

        await initMqttHandler();

        await initGrpcStreamHandler();

        try {
            await showDataMigrationIssues();
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
    } catch {}
});

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
    } catch {}
}
