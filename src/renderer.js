import { sendRequestBtn, cancelRequestBtn, curlBtn, importCollectionBtn, urlInput } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl, setUrlUpdating } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest, handleCancelRequest, handleGenerateCurl } from './modules/apiHandler.js';
import { loadCollections, importOpenApiFile, initializeBodyTracking, restoreLastSelectedRequest } from './modules/collectionManager.js';
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
import { ProxyController } from './modules/controllers/ProxyController.js';
import { ProxyRepository } from './modules/storage/ProxyRepository.js';
import { ProxyService } from './modules/services/ProxyService.js';
import { StatusDisplayAdapter } from './modules/interfaces/IStatusDisplay.js';
import { keyboardShortcuts } from './modules/keyboardShortcuts.js';

const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const timeoutManager = new TimeoutManager();

// Initialize shared status display adapter
const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);

// Initialize proxy system
const proxyRepository = new ProxyRepository(window.electronAPI);
const proxyService = new ProxyService(proxyRepository, statusDisplayAdapter);
const proxyController = new ProxyController(proxyService);

// Initialize environment system
const environmentRepository = new EnvironmentRepository(window.electronAPI);
const environmentService = new EnvironmentService(environmentRepository, statusDisplayAdapter);
const environmentManager = new EnvironmentManager(environmentService);
const environmentSelector = new EnvironmentSelector(
    environmentService,
    (envId) => environmentController.switchEnvironment(envId),
    () => environmentController.openEnvironmentManager()
);
const environmentController = new EnvironmentController(
    environmentService,
    environmentManager,
    environmentSelector
);

// Initialize settings modal with all managers
const settingsModal = new SettingsModal(themeManager, i18n, httpVersionManager, timeoutManager, proxyController);

// Initialize history controller
const historyController = new HistoryController(window.electronAPI);

// Initialize keyboard shortcuts
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
        handler: (e) => {
            if (urlInput) {
                urlInput.focus();
                urlInput.select();
            }
        },
        description: 'Focus URL bar',
        category: 'Navigation'
    });

    keyboardShortcuts.register('KeyB', {
        ctrl: true,
        handler: () => {
            const collectionsSidebar = document.getElementById('collections-sidebar');
            const collectionResizerHandle = document.getElementById('collection-resizer-handle');
            if (collectionsSidebar && collectionResizerHandle) {
                const isVisible = collectionsSidebar.classList.contains('visible');
                if (isVisible) {
                    collectionsSidebar.classList.remove('visible');
                    collectionResizerHandle.classList.remove('visible');
                } else {
                    collectionsSidebar.classList.add('visible');
                    collectionResizerHandle.classList.add('visible');
                }
            }
        },
        description: 'Toggle collections sidebar',
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
                    if (historyToggleBtn) historyToggleBtn.classList.remove('active');
                } else {
                    historySidebar.classList.add('visible');
                    historyResizerHandle.classList.add('visible');
                    if (historyToggleBtn) historyToggleBtn.classList.add('active');
                }
            }
        },
        description: 'Toggle history sidebar',
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

    keyboardShortcuts.register('Slash', {
        shift: true,
        handler: () => {
            keyboardShortcuts.showHelp();
        },
        description: 'Show keyboard shortcuts (alternative)',
        category: 'Help'
    });

    // Tab Switching
    keyboardShortcuts.register('Digit1', {
        ctrl: true,
        handler: () => activateTab('request', 'path-params'),
        description: 'Switch to Path Params tab',
        category: 'Tabs'
    });

    keyboardShortcuts.register('Digit2', {
        ctrl: true,
        handler: () => activateTab('request', 'query-params'),
        description: 'Switch to Query Params tab',
        category: 'Tabs'
    });

    keyboardShortcuts.register('Digit3', {
        ctrl: true,
        handler: () => activateTab('request', 'headers'),
        description: 'Switch to Headers tab',
        category: 'Tabs'
    });

    keyboardShortcuts.register('Digit4', {
        ctrl: true,
        handler: () => activateTab('request', 'body'),
        description: 'Switch to Body tab',
        category: 'Tabs'
    });

    keyboardShortcuts.register('Digit5', {
        ctrl: true,
        handler: () => activateTab('request', 'auth'),
        description: 'Switch to Auth tab',
        category: 'Tabs'
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    curlBtn.addEventListener('click', handleGenerateCurl);
    sendRequestBtn.addEventListener('click', handleSendRequest);
    cancelRequestBtn.addEventListener('click', handleCancelRequest);
    importCollectionBtn.addEventListener('click', importOpenApiFile);

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.show();
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

    await i18n.init();

    window.i18n = i18n;
    window.authManager = authManager;
    window.historyController = historyController;
    window.environmentController = environmentController;
    window.setUrlUpdating = setUrlUpdating;

    // Initialize environment selector
    environmentSelector.initialize('environment-selector-container');

    // Initialize environment controller and load active environment
    await environmentController.initialize();

    // Initialize history controller
    await historyController.init();

    document.addEventListener('languageChanged', (event) => {
        // Any dynamic content that needs special handling can be refreshed here
    });

    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initTabListeners();
    initializeBodyTracking();
    initResizer();
    initializeCopyHandler();
    initKeyboardShortcuts();

    activateTab('response', 'response-body');
    activateTab('request', 'path-params');

    await loadCollections();

    const pathParamsList = document.getElementById('path-params-list');
    const headersList = document.getElementById('headers-list');
    const queryParamsList = document.getElementById('query-params-list');

    if (pathParamsList.children.length === 0) addKeyValueRow(pathParamsList);
    if (headersList.children.length === 0) addKeyValueRow(headersList, 'Content-Type', 'application/json');

    updateQueryParamsFromUrl();

    await restoreLastSelectedRequest();
});