/**
 * @fileoverview Tab switching and management for request/response UI sections
 * @module modules/tabManager
 */

/**
 * Initializes tab switching event listeners for request and response tabs
 *
 * Sets up click handlers for request configuration tabs (Query Params, Headers, Body, Auth)
 * and response display tabs (Body, Headers, Cookies, Performance). Handles workspace
 * tab integration for per-tab response displays.
 *
 * @returns {void}
 *
 * @example
 * initTabListeners();
 */
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

            // Get the active workspace tab container
            const activeContainer = document.querySelector('.workspace-tab-response[style*="display: flex"]');
            if (activeContainer) {
                // Deactivate all tab contents in this workspace tab
                const allContents = activeContainer.querySelectorAll('.tab-content');
                allContents.forEach(content => content.classList.remove('active'));

                // Get the workspace tab ID and activate the correct content
                const workspaceTabId = activeContainer.dataset.tabId;
                const targetTabContent = document.getElementById(`${targetTabId}-${workspaceTabId}`);
                if (targetTabContent) {
                    targetTabContent.classList.add('active');
                }
            } else {
                // Fallback for old structure
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
 * Programmatically activates a tab
 *
 * @param {string} tabType - Tab type ('request' or 'response')
 * @param {string} tabId - Tab ID to activate
 * @returns {void}
 *
 * @example
 * activateTab('response', 'response-body');
 * activateTab('request', 'headers');
 */
/**
 * Switch response tabs visibility based on protocol (HTTP vs gRPC)
 * Shows HTTP tabs (Headers, Cookies, Performance, Scripts) for HTTP requests
 * Shows gRPC tabs (Metadata, Trailers) for gRPC requests
 *
 * @param {string} protocol - 'http' or 'grpc'
 * @returns {void}
 */
export function setResponseTabsForProtocol(protocol) {
    const httpTabs = document.querySelectorAll('.response-tabs .tab-button[data-protocol="http"]');
    const grpcTabs = document.querySelectorAll('.response-tabs .tab-button[data-protocol="grpc"]');

    if (protocol === 'grpc') {
        httpTabs.forEach(tab => tab.style.display = 'none');
        grpcTabs.forEach(tab => tab.style.display = '');
    } else {
        httpTabs.forEach(tab => tab.style.display = '');
        grpcTabs.forEach(tab => tab.style.display = 'none');
    }

    // If the currently active tab is now hidden, switch to Body tab
    const activeTab = document.querySelector('.response-tabs .tab-button.active');
    if (activeTab && activeTab.style.display === 'none') {
        activateTab('response', 'response-body');
    }
}

export function activateTab(tabType, tabId) {
    let buttons;
    let contents;

    if (tabType === 'request') {
        buttons = document.querySelectorAll('.request-config .tab-button');
        contents = document.querySelectorAll('.request-config .tab-content');
    } else if (tabType === 'response') {
        buttons = document.querySelectorAll('.response-tabs .tab-button');
        // Get response tab contents from the active workspace tab container
        const activeContainer = document.querySelector('.workspace-tab-response[style*="display: flex"]');
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

    // For response tabs, need to find the content within the active workspace tab
    let targetContent;
    if (tabType === 'response') {
        const activeContainer = document.querySelector('.workspace-tab-response[style*="display: flex"]');
        if (activeContainer) {
            // Get the workspace tab ID from the container
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
