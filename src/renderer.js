import { sendRequestBtn, cancelRequestBtn, curlBtn, importCollectionBtn } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow, updateQueryParamsFromUrl } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest, handleCancelRequest, handleGenerateCurl } from './modules/apiHandler.js';
import { loadCollections, importOpenApiFile, initializeBodyTracking, restoreLastSelectedRequest } from './modules/collectionManager.js';
import { ThemeManager, SettingsModal } from './modules/themeManager.js';
import { HttpVersionManager } from './modules/httpVersionManager.js';
import { initResizer } from './modules/resizer.js';
import { i18n } from './i18n/I18nManager.js';
import { authManager } from './modules/authManager.js';

const themeManager = new ThemeManager();
const httpVersionManager = new HttpVersionManager();
const settingsModal = new SettingsModal(themeManager, i18n, httpVersionManager);

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

    await i18n.init();

    window.i18n = i18n;
    window.authManager = authManager;

    document.addEventListener('languageChanged', (event) => {
        // Any dynamic content that needs special handling can be refreshed here
    });

    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initTabListeners();
    initializeBodyTracking();
    initResizer();

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