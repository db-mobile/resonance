/**
 * @fileoverview Alt+N / Alt+Shift+N shortcuts that follow the visible request and response tabs left to right
 * @module modules/tabShortcuts
 */

import { app } from './appContext.js';
import { activateTab, visibleTabButtons } from './tabManager.js';

export const MAX_TAB_SHORTCUTS = 9;

const TAB_BARS = [
    { tabType: 'request', shift: false, category: 'Request Tabs' },
    { tabType: 'response', shift: true, category: 'Response Tabs' }
];

/**
 * @param {'request'|'response'} tabType
 * @param {number} n
 * @returns {boolean}
 */
export function activateNthVisibleTab(tabType, n) {
    const button = visibleTabButtons(tabType)[n - 1];
    if (!button) {
        return false;
    }
    activateTab(tabType, button.dataset.tab);
    return true;
}

/**
 * @param {'request'|'response'} tabType
 * @param {number} n
 * @returns {string|null}
 */
function describeNthVisibleTab(tabType, n) {
    const button = visibleTabButtons(tabType)[n - 1];
    if (!button) {
        return null;
    }
    const label = button.textContent.trim();
    return app.i18n?.t('shortcuts.switch_to_tab', { label }) ?? `Switch to ${label} tab`;
}

/**
 * @param {{register: Function}} shortcuts
 * @returns {void}
 */
export function registerTabShortcuts(shortcuts) {
    for (const { tabType, shift, category } of TAB_BARS) {
        for (let n = 1; n <= MAX_TAB_SHORTCUTS; n++) {
            shortcuts.register(`Digit${n}`, {
                alt: true,
                shift,
                category,
                description: `Switch to ${tabType} tab ${n}`,
                describe: () => describeNthVisibleTab(tabType, n),
                handler: () => activateNthVisibleTab(tabType, n)
            });
        }
    }
}
