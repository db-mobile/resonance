import { sendRequestBtn, importCollectionBtn } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { handleSendRequest } from './modules/apiHandler.js';
import { loadCollections, importOpenApiFile } from './modules/collectionManager.js';

sendRequestBtn.addEventListener('click', handleSendRequest);
importCollectionBtn.addEventListener('click', importOpenApiFile);

document.addEventListener('DOMContentLoaded', async () => {
    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initTabListeners();

    activateTab('response', 'response-body');
    activateTab('request', 'query-params');

    await loadCollections();

    const headersList = document.getElementById('headers-list');
    const queryParamsList = document.getElementById('query-params-list');
    if (headersList.children.length === 0) addKeyValueRow(headersList);
    if (queryParamsList.children.length === 0) addKeyValueRow(queryParamsList);
});