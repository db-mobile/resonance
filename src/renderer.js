import { sendRequestBtn } from './modules/domElements.js';

import { initKeyValueListeners, addKeyValueRow } from './modules/keyValueManager.js';
import { initTabListeners, activateTab } from './modules/tabManager.js';
import { updateStatusDisplay } from './modules/statusDisplay.js';
import { loadRequests, populateRequestForm } from './modules/requestHistory.js';
import { handleSendRequest } from './modules/apiHandler.js';

sendRequestBtn.addEventListener('click', handleSendRequest);

document.addEventListener('DOMContentLoaded', async () => {
    updateStatusDisplay('Ready', null);

    initKeyValueListeners();
    initTabListeners();

    activateTab('response', 'response-body');
    activateTab('request', 'query-params');

    await loadRequests();

    const requestListDiv = document.getElementById('request-list');
    if (requestListDiv.querySelector('.request-item')) {
        requestListDiv.querySelector('.request-item').click();
    } else {
        const headersList = document.getElementById('headers-list');
        const queryParamsList = document.getElementById('query-params-list');
        if (headersList.children.length === 0) addKeyValueRow(headersList);
        if (queryParamsList.children.length === 0) addKeyValueRow(queryParamsList);
    }
});