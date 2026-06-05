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
    GRPC: 'grpc',
    SSE: 'sse',
    MQTT: 'mqtt'
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
 * Tabs shown in SSE mode (no body, since SSE is GET-only)
 * @type {string[]}
 */
const SSE_TABS = ['query-params', 'headers'];

/**
 * Tabs shown in MQTT mode (broker config tab + message payload)
 * @type {string[]}
 */
const MQTT_TABS = ['mqtt', 'body'];

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
 * HTTP-only shared tabs (like scripts, not needed for gRPC/WebSocket)
 * @type {string[]}
 */
const HTTP_SHARED_TABS = ['scripts', 'schema'];

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
 * Check if current mode is SSE
 * @returns {boolean}
 */
export function isSseMode() {
    return currentMode === RequestMode.SSE;
}

/**
 * Check if current mode is MQTT
 * @returns {boolean}
 */
export function isMqttMode() {
    return currentMode === RequestMode.MQTT;
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
    if (mode !== RequestMode.HTTP
        && mode !== RequestMode.WEBSOCKET
        && mode !== RequestMode.GRPC
        && mode !== RequestMode.SSE
        && mode !== RequestMode.MQTT) {
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
        showSseUrlSection(false);
        showMqttUrlSection(false);
        
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
    } else if (mode === RequestMode.SSE) {
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
        showWebSocketUrlSection(false);
        showSseUrlSection(true);
        showMqttUrlSection(false);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (SSE_TABS.includes(tabId)) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });

        if (bodyModeContainer) {
            bodyModeContainer.style.display = 'none';
        }
        if (window.graphqlBodyManager) {
            window.graphqlBodyManager.setGraphQLModeEnabled(false);
        }

        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || activeTab.style.display === 'none') {
            activateTab('headers');
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
        showSseUrlSection(false);
        showMqttUrlSection(false);

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
    } else if (mode === RequestMode.MQTT) {
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
        showWebSocketUrlSection(false);
        showSseUrlSection(false);
        showMqttUrlSection(true);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (MQTT_TABS.includes(tabId)) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
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
            bodyTitle.textContent = 'Payload';
        }

        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || activeTab.style.display === 'none') {
            activateTab('mqtt');
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
        showSseUrlSection(false);
        showMqttUrlSection(false);
        
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

function showSseUrlSection(show) {
    let sseUrlSection = document.getElementById('sse-url-section');

    if (show) {
        if (!sseUrlSection) {
            sseUrlSection = createSseUrlSection();
        }
        if (sseUrlSection) {
            syncSseUrlInput();
            sseUrlSection.style.display = 'flex';
        }
    } else if (sseUrlSection) {
        sseUrlSection.style.display = 'none';
    }
}

function createSseUrlSection() {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }

    const sseSection = document.createElement('div');
    sseSection.id = 'sse-url-section';
    sseSection.className = 'grpc-url-section';
    sseSection.style.display = 'none';

    const badge = document.createElement('span');
    badge.className = 'protocol-url-badge protocol-url-badge-sse';
    badge.textContent = 'SSE';

    const targetWrapper = document.createElement('div');
    targetWrapper.className = 'grpc-target-wrapper';

    const existingUrlInput = document.getElementById('url-input');
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.id = 'sse-url-input';
    urlInput.className = 'input-base url-input';
    urlInput.placeholder = 'https://example.com/events';
    urlInput.setAttribute('aria-label', 'SSE URL');

    if (existingUrlInput) {
        urlInput.value = existingUrlInput.value;
        urlInput.addEventListener('input', () => {
            existingUrlInput.value = urlInput.value;
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
        existingUrlInput.addEventListener('input', () => {
            urlInput.value = existingUrlInput.value;
        });
    }

    targetWrapper.appendChild(urlInput);
    sseSection.appendChild(badge);
    sseSection.appendChild(targetWrapper);

    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(sseSection);
    } else {
        requestUrlSection.prepend(sseSection);
    }

    return sseSection;
}

function syncSseUrlInput() {
    const existingUrlInput = document.getElementById('url-input');
    const sseUrlInput = document.getElementById('sse-url-input');

    if (existingUrlInput && sseUrlInput) {
        sseUrlInput.value = existingUrlInput.value;
    }
}

function showMqttUrlSection(show) {
    let mqttUrlSection = document.getElementById('mqtt-url-section');

    if (show) {
        if (!mqttUrlSection) {
            mqttUrlSection = createMqttUrlSection();
        }
        if (mqttUrlSection) {
            syncMqttBrokerInput();
            mqttUrlSection.style.display = 'flex';
        }
    } else if (mqttUrlSection) {
        mqttUrlSection.style.display = 'none';
    }
}

function createMqttUrlSection() {
    const requestUrlSection = document.querySelector('.request-url-section');
    if (!requestUrlSection) {
        return null;
    }

    const mqttSection = document.createElement('div');
    mqttSection.id = 'mqtt-url-section';
    mqttSection.className = 'grpc-url-section';
    mqttSection.style.display = 'none';

    const badge = document.createElement('span');
    badge.className = 'protocol-url-badge protocol-url-badge-mqtt';
    badge.textContent = 'MQTT';

    const targetWrapper = document.createElement('div');
    targetWrapper.className = 'grpc-target-wrapper';

    const existingUrlInput = document.getElementById('url-input');
    const brokerInput = document.createElement('input');
    brokerInput.type = 'text';
    brokerInput.id = 'mqtt-broker-input';
    brokerInput.className = 'input-base url-input';
    brokerInput.placeholder = 'mqtt://localhost:1883';
    brokerInput.setAttribute('aria-label', 'MQTT Broker URL');

    if (existingUrlInput) {
        brokerInput.value = existingUrlInput.value;
        brokerInput.addEventListener('input', () => {
            existingUrlInput.value = brokerInput.value;
            if (window.workspaceTabController && !window.workspaceTabController.isRestoringState) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
        existingUrlInput.addEventListener('input', () => {
            brokerInput.value = existingUrlInput.value;
        });
    }

    targetWrapper.appendChild(brokerInput);
    mqttSection.appendChild(badge);
    mqttSection.appendChild(targetWrapper);

    const methodSelectContainer = document.querySelector('.method-select-container');
    if (methodSelectContainer) {
        methodSelectContainer.after(mqttSection);
    } else {
        requestUrlSection.prepend(mqttSection);
    }

    return mqttSection;
}

function syncMqttBrokerInput() {
    const existingUrlInput = document.getElementById('url-input');
    const mqttBrokerInput = document.getElementById('mqtt-broker-input');

    if (existingUrlInput && mqttBrokerInput) {
        mqttBrokerInput.value = existingUrlInput.value;
    }
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
