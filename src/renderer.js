import { sendRequestBtn, cancelRequestBtn, curlBtn, importCollectionBtn } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl } from './modules/keyValueManager.js';
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
import { StatusDisplayAdapter } from './modules/interfaces/IStatusDisplay.js';

const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const timeoutManager = new TimeoutManager();
const settingsModal = new SettingsModal(themeManager, i18n, httpVersionManager, timeoutManager);
const historyController = new HistoryController(window.electronAPI);

// Initialize environment system
const statusDisplayAdapter = new StatusDisplayAdapter(updateStatusDisplay);
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