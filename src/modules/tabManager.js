/**
 * @fileoverview Tab switching and management for request/response UI sections
 * @module modules/tabManager
 */

import { getProtocol } from './protocols/protocolRegistry.js';

/** @returns {void} */
export function initTabListeners() {
    const requestTabButtons = document.querySelectorAll('.request-config .tab-button');
    const requestTabContents = document.querySelectorAll('.request-config .tab-content');

    requestTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            requestTabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });
            requestTabContents.forEach(content => content.classList.remove('active'));

            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');

            const targetTabId = button.dataset.tab;
            const targetTabContent = document.getElementById(targetTabId);
            if (targetTabContent) {
                targetTabContent.classList.add('active');
            }
        });
    });

    const responseTabButtons = document.querySelectorAll('.response-tabs .tab-button');

    responseTabButtons.forEach(button => {
        button.addEventListener('click', () => {
            responseTabButtons.forEach(btn => {
                btn.classList.remove('active');
                btn.setAttribute('aria-selected', 'false');
            });

            button.classList.add('active');
            button.setAttribute('aria-selected', 'true');

            const targetTabId = button.dataset.tab;

            const activeContainer = document.querySelector('.workspace-tab-response:not(.is-hidden)');
            if (activeContainer) {
                const allContents = activeContainer.querySelectorAll('.tab-content');
                allContents.forEach(content => content.classList.remove('active'));

                const workspaceTabId = activeContainer.dataset.tabId;
                const targetTabContent = document.getElementById(`${targetTabId}-${workspaceTabId}`);
                if (targetTabContent) {
                    targetTabContent.classList.add('active');
                }
            } else {
                const responseTabContents = document.querySelectorAll('.response-display .tab-content');
                responseTabContents.forEach(content => content.classList.remove('active'));

                const targetTabContent = document.getElementById(targetTabId);
                if (targetTabContent) {
                    targetTabContent.classList.add('active');
                }
            }
        });
    });
}

/**
 * @param {'request'|'response'} tabType
 * @returns {HTMLElement[]}
 */
export function visibleTabButtons(tabType) {
    const selector = tabType === 'request'
        ? '.request-config .tab-nav .tab-button'
        : '.response-tabs .tab-button';
    return Array.from(document.querySelectorAll(selector)).filter(btn =>
        btn.style.display !== 'none' && !btn.classList.contains('is-hidden') && !btn.hidden
    );
}

/**
 * @param {string} protocol
 * @returns {void}
 */
export function setResponseTabsForProtocol(protocol) {
    const tabSet = getProtocol(protocol).responseTabSet;
    const httpTabs = document.querySelectorAll('.response-tabs .tab-button[data-protocol="http"]');
    const grpcTabs = document.querySelectorAll('.response-tabs .tab-button[data-protocol="grpc"]');

    httpTabs.forEach(tab => tab.classList.toggle('is-hidden', tabSet !== 'http'));
    grpcTabs.forEach(tab => tab.classList.toggle('is-hidden', tabSet !== 'grpc'));

    const activeTab = document.querySelector('.response-tabs .tab-button.active');
    if (activeTab && activeTab.classList.contains('is-hidden')) {
        activateTab('response', 'response-body');
    }
}

/**
 * @param {string} tabType
 * @param {string} tabId
 * @returns {void}
 */
export function activateTab(tabType, tabId) {
    let buttons;
    let contents;

    if (tabType === 'request') {
        buttons = document.querySelectorAll('.request-config .tab-button');
        contents = document.querySelectorAll('.request-config .tab-content');
    } else if (tabType === 'response') {
        buttons = document.querySelectorAll('.response-tabs .tab-button');
        const activeContainer = document.querySelector('.workspace-tab-response:not(.is-hidden)');
        if (activeContainer) {
            contents = activeContainer.querySelectorAll('.tab-content');
        } else {
            contents = document.querySelectorAll('.response-display .tab-content');
        }
    } else {
        return;
    }

    buttons.forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });
    contents.forEach(content => content.classList.remove('active'));

    const targetButton = document.querySelector(`.${tabType === 'request' ? 'request-config' : 'response-tabs'} .tab-button[data-tab="${tabId}"]`);

    let targetContent;
    if (tabType === 'response') {
        const activeContainer = document.querySelector('.workspace-tab-response:not(.is-hidden)');
        if (activeContainer) {
            const workspaceTabId = activeContainer.dataset.tabId;
            targetContent = document.getElementById(`${tabId}-${workspaceTabId}`);
        } else {
            targetContent = document.getElementById(tabId);
        }
    } else {
        targetContent = document.getElementById(tabId);
    }

    if (targetButton) {
        targetButton.classList.add('active');
        targetButton.setAttribute('aria-selected', 'true');
    }
    if (targetContent) {
        targetContent.classList.add('active');
    }
}
