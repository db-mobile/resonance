/**
 * @fileoverview Manages UI mode switching between HTTP, WebSocket, and gRPC requests
 * @module modules/requestModeManager
 */

import { setResponseTabsForProtocol } from './tabManager.js';

/**
 * Request protocol modes
 * @enum {string}
 */
export const RequestMode = {
    HTTP: 'http',
    WEBSOCKET: 'websocket',
    GRPC: 'grpc'
};

/**
 * Current request mode
 * @type {string}
 */
let currentMode = RequestMode.HTTP;

/**
 * HTTP-only request tab IDs
 * @type {string[]}
 */
const HTTP_ONLY_TABS = ['path-params'];

/**
 * Request tab IDs shared by HTTP and WebSocket
 * @type {string[]}
 */
const HTTP_AND_WEBSOCKET_TABS = ['query-params', 'headers', 'body'];

/**
 * gRPC-specific tab IDs that should be hidden in HTTP mode
 * @type {string[]}
 */
const GRPC_ONLY_TABS = ['grpc', 'grpc-message', 'grpc-metadata'];

/**
 * Tabs shared between HTTP and gRPC modes
 * @type {string[]}
 */
const SHARED_TABS = ['authorization'];

/**
 * HTTP-only shared tabs (like scripts, not needed for gRPC)
 * @type {string[]}
 */
const HTTP_SHARED_TABS = ['scripts'];

/**
 * Get the current request mode
 * @returns {string}
 */
export function getCurrentMode() {
    return currentMode;
}

/**
 * Check if current mode is gRPC
 * @returns {boolean}
 */
export function isGrpcMode() {
    return currentMode === RequestMode.GRPC;
}

/**
 * Check if current mode is WebSocket
 * @returns {boolean}
 */
export function isWebSocketMode() {
    return currentMode === RequestMode.WEBSOCKET;
}

/**
 * Check if current mode is HTTP
 * @returns {boolean}
 */
export function isHttpMode() {
    return currentMode === RequestMode.HTTP;
}

/**
 * Set the request mode and update UI accordingly
 * @param {string} mode - The mode to set
 */
export function setRequestMode(mode) {
    if (mode !== RequestMode.HTTP && mode !== RequestMode.WEBSOCKET && mode !== RequestMode.GRPC) {
        console.warn(`Invalid request mode: ${mode}, defaulting to HTTP`);
        mode = RequestMode.HTTP;
    }
    
    currentMode = mode;
    updateUIForMode(mode);
    
    // Update response tabs for the current protocol
    setResponseTabsForProtocol(mode);
}

/**
 * Update UI elements based on the current mode
 * @param {string} mode
 */
function updateUIForMode(mode) {
    const methodSelectContainer = document.querySelector('.method-select-container');
    const urlInput = document.getElementById('url-input');
    const urlInputContainer = urlInput?.closest('.url-autocomplete-wrapper') || urlInput;
    const curlBtn = document.getElementById('curl-btn');
    const bodyModeSelect = document.getElementById('body-mode-select');
    const bodyModeContainer = bodyModeSelect?.closest('.body-mode-selector-container');
    const bodyTitle = document.querySelector('#body h3');
    
    // Get all request config tab buttons
    const tabButtons = document.querySelectorAll('.request-config .tab-nav .tab-button');
    
    if (mode === RequestMode.GRPC) {
        // Hide HTTP-specific URL section elements
        if (methodSelectContainer) {
            methodSelectContainer.style.display = 'none';
        }
        if (urlInputContainer) {
            urlInputContainer.style.display = 'none';
        }
        if (curlBtn) {
            curlBtn.style.display = 'none';
        }
        
        // Show gRPC target input in URL section
        showGrpcUrlSection(true);
        showWebSocketUrlSection(false);
        
        // Update tab visibility - show gRPC tabs, hide HTTP-only tabs
        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (HTTP_ONLY_TABS.includes(tabId) || HTTP_AND_WEBSOCKET_TABS.includes(tabId) || HTTP_SHARED_TABS.includes(tabId)) {
                btn.style.display = 'none';
            } else if (GRPC_ONLY_TABS.includes(tabId) || SHARED_TABS.includes(tabId)) {
                btn.style.display = '';
            }
        });

        if (bodyModeSelect) {
            bodyModeSelect.disabled = false;
        }
        if (bodyModeContainer) {
            bodyModeContainer.style.display = '';
        }
        if (bodyTitle) {
            bodyTitle.textContent = 'Request Body';
        }
        
        // Activate gRPC tab if current tab is HTTP-only
        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab
            || HTTP_ONLY_TABS.includes(activeTab.dataset.tab)
            || HTTP_AND_WEBSOCKET_TABS.includes(activeTab.dataset.tab)
            || HTTP_SHARED_TABS.includes(activeTab.dataset.tab)) {
            activateTab('grpc');
        }
    } else if (mode === RequestMode.WEBSOCKET) {
        if (methodSelectContainer) {
            methodSelectContainer.style.display = 'none';
        }
        if (urlInputContainer) {
            urlInputContainer.style.display = 'none';
        }
        if (curlBtn) {
            curlBtn.style.display = 'none';
        }

        showGrpcUrlSection(false);
        showWebSocketUrlSection(true);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (HTTP_ONLY_TABS.includes(tabId)
                || GRPC_ONLY_TABS.includes(tabId)
                || SHARED_TABS.includes(tabId)
                || HTTP_SHARED_TABS.includes(tabId)) {
                btn.style.display = 'none';
            } else if (HTTP_AND_WEBSOCKET_TABS.includes(tabId)) {
                btn.style.display = '';
            }
        });

        if (bodyModeSelect) {
            bodyModeSelect.value = 'json';
            bodyModeSelect.disabled = true;
        }
        if (bodyModeContainer) {
            bodyModeContainer.style.display = 'none';
        }
        if (window.graphqlBodyManager) {
            window.graphqlBodyManager.setGraphQLModeEnabled(false);
        }
        if (bodyTitle) {
            bodyTitle.textContent = 'Message';
        }

        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || activeTab.style.display === 'none') {
            activateTab('body');
        }
    } else {
        // Show HTTP-specific URL section elements
        if (methodSelectContainer) {
            methodSelectContainer.style.display = '';
        }
        if (urlInputContainer) {
            urlInputContainer.style.display = '';
        }
        if (curlBtn) {
            curlBtn.style.display = '';
        }
        
        // Hide gRPC target input from URL section
        showGrpcUrlSection(false);
        showWebSocketUrlSection(false);
        
        // Update tab visibility - show HTTP tabs, hide gRPC-only tabs
        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (GRPC_ONLY_TABS.includes(tabId)) {
                btn.style.display = 'none';
            } else if (HTTP_ONLY_TABS.includes(tabId)
                || HTTP_AND_WEBSOCKET_TABS.includes(tabId)
                || SHARED_TABS.includes(tabId)
                || HTTP_SHARED_TABS.includes(tabId)) {
                btn.style.display = '';
            }
        });

        if (bodyModeSelect) {
            bodyModeSelect.disabled = false;
        }
        if (bodyModeContainer) {
            bodyModeContainer.style.display = '';
        }
        if (bodyTitle) {
            bodyTitle.textContent = 'Request Body';
        }
        
        // Activate path-params tab if current tab is gRPC-only
        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || GRPC_ONLY_TABS.includes(activeTab.dataset.tab)) {
            activateHttpTab();
        }
    }
}

/**
 * Activate a specific tab by ID
 * @param {string} tabId
 */
function activateTab(tabId) {
    const tabBtn = document.querySelector(`.request-config .tab-nav .tab-button[data-tab="${tabId}"]`);
    if (tabBtn) {
        tabBtn.click();
    }
}

/**
 * Show or hide the gRPC URL section elements
 * @param {boolean} show
 */
function showGrpcUrlSection(show) {
    let grpcUrlSection = document.getElementById('grpc-url-section');
    
    if (show) {
        if (!grpcUrlSection) {
            // Create gRPC URL section if it doesn't exist
            grpcUrlSection = createGrpcUrlSection();
        }
        grpcUrlSection.style.display = 'flex';
    } else if (grpcUrlSection) {
        grpcUrlSection.style.display = 'none';
    }
}

/**
 * Show or hide the WebSocket URL section elements
 * @param {boolean} show
 */
function showWebSocketUrlSection(show) {
    let websocketUrlSection = document.getElementById('websocket-url-section');

    if (show) {
        if (!websocketUrlSection) {
            websocketUrlSection = createWebSocketUrlSection();
        }
        if (websocketUrlSection) {
            syncWebSocketUrlInput();
            websocketUrlSection.style.display = 'flex';
        }
    } else if (websocketUrlSection) {
        websocketUrlSection.style.display = 'none';
    }
}

/**
 * Create the gRPC URL section elements
 * @returns {HTMLElement}
 */
function createGrpcUrlSection() {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }
    
    // Create container for gRPC URL elements
    const grpcSection = document.createElement('div');
    grpcSection.id = 'grpc-url-section';
    grpcSection.className = 'grpc-url-section';
    grpcSection.style.display = 'none';
    
    // gRPC badge
    const badge = document.createElement('span');
    badge.className = 'protocol-url-badge protocol-url-badge-grpc';
    badge.textContent = 'gRPC';
    
    // Target input wrapper
    const targetWrapper = document.createElement('div');
    targetWrapper.className = 'grpc-target-wrapper';
    
    // Target input (reuse existing or create reference)
    const existingTarget = document.getElementById('grpc-target-input');
    const targetInput = document.createElement('input');
    targetInput.type = 'text';
    targetInput.id = 'grpc-url-target-input';
    targetInput.className = 'input-base url-input';
    targetInput.placeholder = 'localhost:50051';
    targetInput.setAttribute('aria-label', 'gRPC Target');
    
    // Sync with existing target input
    if (existingTarget) {
        targetInput.value = existingTarget.value;
        targetInput.addEventListener('input', () => {
            existingTarget.value = targetInput.value;
            // Mark tab as modified when gRPC target changes
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
        existingTarget.addEventListener('input', () => {
            targetInput.value = existingTarget.value;
        });
    }
    
    targetWrapper.appendChild(targetInput);
    
    grpcSection.appendChild(badge);
    grpcSection.appendChild(targetWrapper);
    
    // Insert after method select container
    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(grpcSection);
    } else {
        requestUrlSection.prepend(grpcSection);
    }
    
    return grpcSection;
}

/**
 * Create the WebSocket URL section elements
 * @returns {HTMLElement}
 */
function createWebSocketUrlSection() {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }

    const websocketSection = document.createElement('div');
    websocketSection.id = 'websocket-url-section';
    websocketSection.className = 'grpc-url-section';
    websocketSection.style.display = 'none';

    const badge = document.createElement('span');
    badge.className = 'protocol-url-badge protocol-url-badge-ws';
    badge.textContent = 'WS';

    const targetWrapper = document.createElement('div');
    targetWrapper.className = 'grpc-target-wrapper';

    const existingUrlInput = document.getElementById('url-input');
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.id = 'websocket-url-input';
    urlInput.className = 'input-base url-input';
    urlInput.placeholder = 'wss://echo.websocket.events';
    urlInput.setAttribute('aria-label', 'WebSocket URL');

    if (existingUrlInput) {
        urlInput.value = existingUrlInput.value;
        urlInput.addEventListener('input', () => {
            existingUrlInput.value = urlInput.value;
            // Mark tab as modified when WebSocket URL changes
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
        existingUrlInput.addEventListener('input', () => {
            urlInput.value = existingUrlInput.value;
        });
    }

    targetWrapper.appendChild(urlInput);
    websocketSection.appendChild(badge);
    websocketSection.appendChild(targetWrapper);

    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(websocketSection);
    } else {
        requestUrlSection.prepend(websocketSection);
    }

    return websocketSection;
}

function syncWebSocketUrlInput() {
    const existingUrlInput = document.getElementById('url-input');
    const websocketUrlInput = document.getElementById('websocket-url-input');

    if (existingUrlInput && websocketUrlInput) {
        websocketUrlInput.value = existingUrlInput.value;
    }
}

/**
 * Activate the default HTTP tab (path-params)
 */
function activateHttpTab() {
    const pathParamsBtn = document.querySelector('.request-config .tab-nav .tab-button[data-tab="path-params"]');
    if (pathParamsBtn) {
        pathParamsBtn.click();
    }
}

/**
 * Initialize the request mode manager
 * Sets up initial state based on current UI
 */
export function initRequestModeManager() {
    // Default to HTTP mode
    setRequestMode(RequestMode.HTTP);
}
