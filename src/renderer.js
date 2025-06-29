import { sendRequestBtn, importCollectionBtn } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest } from './modules/apiHandler.js';
import { loadCollections, importOpenApiFile, initializeBodyTracking } from './modules/collectionManager.js';
import { ThemeManager, SettingsModal } from './modules/themeManager.js';

// Initialize theme manager
const themeManager = new ThemeManager();
const settingsModal = new SettingsModal(themeManager);

sendRequestBtn.addEventListener('click', handleSendRequest);
importCollectionBtn.addEventListener('click', importOpenApiFile);

// Settings button event listener
const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.show();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initTabListeners();
    initializeBodyTracking();

    activateTab('response', 'response-body');
    activateTab('request', 'query-params');

    await loadCollections();

    const headersList = document.getElementById('headers-list');
    const queryParamsList = document.getElementById('query-params-list');
    if (headersList.children.length === 0) addKeyValueRow(headersList);
    if (queryParamsList.children.length === 0) addKeyValueRow(queryParamsList);
});