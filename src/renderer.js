import { sendRequestBtn, cancelRequestBtn, importCollectionBtn } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest, handleCancelRequest } from './modules/apiHandler.js';
import { loadCollections, importOpenApiFile, initializeBodyTracking } from './modules/collectionManager.js';
import { ThemeManager, SettingsModal } from './modules/themeManager.js';
import { HttpVersionManager } from './modules/httpVersionManager.js';
import { initResizer } from './modules/resizer.js';
import { i18n } from './i18n/I18nManager.js';

// Initialize theme manager, HTTP version manager, and internationalization
const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const settingsModal = new SettingsModal(themeManager, i18n, httpVersionManager);

sendRequestBtn.addEventListener('click', handleSendRequest);
cancelRequestBtn.addEventListener('click', handleCancelRequest);
importCollectionBtn.addEventListener('click', importOpenApiFile);

// Settings button event listener
const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.show();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize internationalization first
    await i18n.init();
    
    // Make i18n globally available for dynamic content
    window.i18n = i18n;
    
    // Listen for language changes to refresh dynamic content
    document.addEventListener('languageChanged', (event) => {
        console.log('Language changed to:', event.detail.language);
        // Any dynamic content that needs special handling can be refreshed here
    });
    
    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initTabListeners();
    initializeBodyTracking();
    initResizer();

    activateTab('response', 'response-body');
    activateTab('request', 'query-params');

    await loadCollections();

    const headersList = document.getElementById('headers-list');
    const queryParamsList = document.getElementById('query-params-list');
    if (headersList.children.length === 0) addKeyValueRow(headersList, 'Content-Type', 'application/json');
    
    // Initialize query params from URL or add empty row
    updateQueryParamsFromUrl();
});