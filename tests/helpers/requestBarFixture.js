/* global document */
/**
 * @fileoverview Renders the shared request-bar markup and wires the real tab
 * @module tests/helpers/requestBarFixture
 */

import { initTabListeners } from '../../src/modules/tabManager.js';
import { app } from '../../src/modules/appContext.js';
import { ALL_BODY_MODES, ALL_REQUEST_TABS, requestBarMarkup } from './requestBarMarkup.js';

export { ALL_BODY_MODES, ALL_REQUEST_TABS };

/** @returns {HTMLSelectElement} */
export function buildRequestBar() {
    document.body.innerHTML = requestBarMarkup();
    initTabListeners();
    return document.getElementById('body-mode-select');
}

/** @returns {Object} */
export function installGraphqlBodyManagerStub() {
    const stub = {
        currentMode: 'json',
        isGraphQLMode() {
            return this.currentMode === 'graphql';
        },
        setGraphQLModeEnabled: jest.fn((enable) => {
            stub.switchMode(enable ? 'graphql' : 'json');
        }),
        switchMode: jest.fn((mode) => {
            stub.currentMode = mode;
            const select = document.getElementById('body-mode-select');
            if (select && select.value !== mode) {
                select.value = mode;
            }
            document.querySelectorAll('.body-mode-panel').forEach((panel) => {
                panel.classList.toggle('active', panel.dataset.mode === mode);
            });
        })
    };

    app.graphqlBodyManager = stub;
    return stub;
}

/** @returns {void} */
export function resetRequestBar() {
    document.body.innerHTML = '';
    delete app.graphqlBodyManager;
}

/** @returns {string[]} */
export function visibleRequestTabs() {
    return Array.from(document.querySelectorAll('.request-config .tab-nav .tab-button'))
        .filter(btn => btn.style.display !== 'none')
        .map(btn => btn.dataset.tab);
}

/** @returns {?string} */
export function activeRequestTab() {
    return document.querySelector('.request-config .tab-nav .tab-button.active')?.dataset.tab ?? null;
}

/** @returns {string[]} */
export function bodyModeValues() {
    return Array.from(document.getElementById('body-mode-select').options, opt => opt.value);
}
