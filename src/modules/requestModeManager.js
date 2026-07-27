/**
 * @fileoverview Manages UI mode switching between HTTP, WebSocket, and gRPC requests
 * @module modules/requestModeManager
 */

import { app } from './appContext.js';
import { RequestMode } from './protocols/protocolRegistry.js';
import { setResponseTabsForProtocol } from './tabManager.js';
import { createMirroredUrlSection, syncMirroredUrlInput } from './ui/mirroredUrlSection.js';

export { RequestMode };

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
 * Tabs shown in SSE mode. A streaming endpoint may take a request document
 * (POST + JSON is the norm for LLM-style streams), so Body is available, and
 * Authorization is editable rather than inherit-only.
 * @type {string[]}
 */
const SSE_TABS = ['query-params', 'headers', 'body', 'authorization'];

/**
 * Body modes offered in SSE mode. A streaming request sends one document;
 * multipart and binary uploads have no meaning here.
 * @type {string[]}
 */
const SSE_BODY_MODES = ['json', 'text'];

/**
 * Tabs shown in MQTT mode (broker config tab + message payload)
 * @type {string[]}
 */
const MQTT_TABS = ['mqtt', 'body'];

/**
 * MQTT-specific tab IDs that should be hidden in non-MQTT modes
 * @type {string[]}
 */
const MQTT_ONLY_TABS = ['mqtt'];

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
 * Tabs shown in GraphQL mode. The query lives in the Body panel (the Workbench);
 * Headers/Authorization/Scripts are normal tabs (same as HTTP), since the transport
 * is HTTP. Only GraphQL Variables live in the Workbench drawer.
 * @type {string[]}
 */
const GRAPHQL_TABS = ['body', 'headers', 'authorization', 'scripts'];

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
 * Check if current mode is GraphQL
 * @returns {boolean}
 */
export function isGraphQLMode() {
    return currentMode === RequestMode.GRAPHQL;
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
        && mode !== RequestMode.MQTT
        && mode !== RequestMode.GRAPHQL) {
        console.warn(`Invalid request mode: ${mode}, defaulting to HTTP`);
        mode = RequestMode.HTTP;
    }
    
    currentMode = mode;
    updateUIForMode(mode);
    
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
    
    const tabButtons = document.querySelectorAll('.request-config .tab-nav .tab-button');

    if (mode !== RequestMode.GRAPHQL && app.graphqlBodyManager?.isGraphQLMode?.()) {
        app.graphqlBodyManager.setGraphQLModeEnabled(false);
    }

    // Every mode starts from the full body-mode list; SSE narrows it below.
    restrictBodyModes(null);

    if (mode === RequestMode.GRPC) {
        if (methodSelectContainer) {
            methodSelectContainer.style.display = 'none';
        }
        if (urlInputContainer) {
            urlInputContainer.style.display = 'none';
        }
        if (curlBtn) {
            curlBtn.style.display = 'none';
        }

        showGrpcUrlSection(true);
        showWebSocketUrlSection(false);
        showSseUrlSection(false);
        showMqttUrlSection(false);
        showGraphQLUrlSection(false);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (HTTP_ONLY_TABS.includes(tabId) || HTTP_AND_WEBSOCKET_TABS.includes(tabId) || HTTP_SHARED_TABS.includes(tabId) || MQTT_ONLY_TABS.includes(tabId)) {
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
        
        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab
            || HTTP_ONLY_TABS.includes(activeTab.dataset.tab)
            || HTTP_AND_WEBSOCKET_TABS.includes(activeTab.dataset.tab)
            || HTTP_SHARED_TABS.includes(activeTab.dataset.tab)
            || MQTT_ONLY_TABS.includes(activeTab.dataset.tab)) {
            activateTab('grpc');
        }
    } else if (mode === RequestMode.SSE) {
        // Both the method select and the SSE badge are shown: the method is
        // now the user's to choose, and the badge still marks the protocol.
        if (methodSelectContainer) {
            methodSelectContainer.style.display = '';
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
        showGraphQLUrlSection(false);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (SSE_TABS.includes(tabId)) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });

        if (bodyModeContainer) {
            bodyModeContainer.style.display = '';
        }
        if (bodyModeSelect) {
            bodyModeSelect.disabled = false;
        }
        restrictBodyModes(SSE_BODY_MODES);
        if (app.graphqlBodyManager) {
            app.graphqlBodyManager.setGraphQLModeEnabled(false);
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
        showGraphQLUrlSection(false);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (HTTP_ONLY_TABS.includes(tabId)
                || GRPC_ONLY_TABS.includes(tabId)
                || SHARED_TABS.includes(tabId)
                || HTTP_SHARED_TABS.includes(tabId)
                || MQTT_ONLY_TABS.includes(tabId)) {
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
        if (app.graphqlBodyManager) {
            app.graphqlBodyManager.setGraphQLModeEnabled(false);
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
        showGraphQLUrlSection(false);

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
        if (app.graphqlBodyManager) {
            app.graphqlBodyManager.setGraphQLModeEnabled(false);
        }
        if (bodyTitle) {
            bodyTitle.textContent = 'Payload';
        }

        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab || activeTab.style.display === 'none') {
            activateTab('mqtt');
        }
    } else if (mode === RequestMode.GRAPHQL) {
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
        showMqttUrlSection(false);
        showGraphQLUrlSection(true);

        if (app.graphqlBodyManager) {
            app.graphqlBodyManager.setGraphQLModeEnabled(true);
        }

        if (bodyModeContainer) {
            bodyModeContainer.style.display = 'none';
        }

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            btn.style.display = GRAPHQL_TABS.includes(tabId) ? '' : 'none';
        });

        if (bodyTitle) {
            bodyTitle.textContent = 'Query';
        }

        activateTab('body');
    } else {
        if (methodSelectContainer) {
            methodSelectContainer.style.display = '';
        }
        if (urlInputContainer) {
            urlInputContainer.style.display = '';
        }
        if (urlInput && urlInput !== urlInputContainer && urlInput.style.display === 'none') {
            urlInput.style.display = '';
        }
        if (curlBtn) {
            curlBtn.style.display = '';
        }

        showGrpcUrlSection(false);
        showWebSocketUrlSection(false);
        showSseUrlSection(false);
        showMqttUrlSection(false);
        showGraphQLUrlSection(false);

        tabButtons.forEach(btn => {
            const tabId = btn.dataset.tab;
            if (GRPC_ONLY_TABS.includes(tabId) || MQTT_ONLY_TABS.includes(tabId)) {
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
        
        const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
        if (!activeTab
            || GRPC_ONLY_TABS.includes(activeTab.dataset.tab)
            || MQTT_ONLY_TABS.includes(activeTab.dataset.tab)) {
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
 * The full body-mode list, captured from the markup so option labels stay in
 * one place. Refreshed whenever the complete set is present, so a later edit or
 * translation is picked up rather than pinned at first use.
 * @type {{value: string, text: string}[]|null}
 */
let bodyModeOptionTemplate = null;

/**
 * Limit which body modes the mode select offers. Pass `null` to restore the
 * full list. When the current selection is no longer allowed it falls back to
 * the first permitted mode, switching the body panel with it.
 *
 * Options are added and removed rather than marked `hidden`: WebKit — which is
 * what the app actually runs on under Linux — ignores `hidden` on `<option>`,
 * so hidden entries would still appear in the dropdown.
 *
 * @param {string[]|null} allowed
 */
function restrictBodyModes(allowed) {
    const bodyModeSelect = document.getElementById('body-mode-select');
    if (!bodyModeSelect) {
        return;
    }

    if (bodyModeSelect.options.length >= (bodyModeOptionTemplate?.length || 0)) {
        bodyModeOptionTemplate = Array.from(bodyModeSelect.options, (option) => ({
            value: option.value,
            text: option.textContent
        }));
    }

    const wanted = allowed
        ? bodyModeOptionTemplate.filter((option) => allowed.includes(option.value))
        : bodyModeOptionTemplate;

    const present = Array.from(bodyModeSelect.options, (option) => option.value).join(',');
    if (present !== wanted.map((option) => option.value).join(',')) {
        const selected = bodyModeSelect.value;
        bodyModeSelect.textContent = '';
        for (const { value, text } of wanted) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            bodyModeSelect.appendChild(option);
        }
        bodyModeSelect.value = selected;
    }

    if (!bodyModeSelect.value && wanted.length > 0) {
        bodyModeSelect.value = wanted[0].value;
        app.graphqlBodyManager?.switchMode(wanted[0].value);
    }
}

/**
 * Per-mode configuration for the protocol URL bars that replace the HTTP
 * method select while a non-HTTP mode is active. `syncQueryParams` is off for
 * the MQTT broker: it is not a query-bearing URL, so driving the query-params
 * table from it would only clear it. gRPC is absent because its bar, with the
 * TLS toggle, lives in the markup and drives `grpc-target-input` directly.
 */
const MIRRORED_URL_SECTIONS = {
    websocket: {
        sectionId: 'websocket-url-section',
        method: 'WS',
        label: 'WS',
        inputId: 'websocket-url-input',
        inputType: 'url',
        placeholder: 'wss://echo.websocket.events',
        ariaLabel: 'WebSocket URL',
        peerId: 'url-input',
        syncQueryParams: true
    },
    sse: {
        sectionId: 'sse-url-section',
        method: 'SSE',
        label: 'SSE',
        inputId: 'sse-url-input',
        inputType: 'url',
        placeholder: 'https://example.com/events',
        ariaLabel: 'SSE URL',
        peerId: 'url-input',
        syncQueryParams: true
    },
    graphql: {
        sectionId: 'graphql-url-section',
        method: 'GRAPHQL',
        label: 'GraphQL',
        inputId: 'graphql-url-input',
        inputType: 'url',
        placeholder: 'https://api.example.com/graphql',
        ariaLabel: 'GraphQL Endpoint URL',
        peerId: 'url-input',
        syncQueryParams: true
    },
    mqtt: {
        sectionId: 'mqtt-url-section',
        method: 'MQTT',
        label: 'MQTT',
        inputId: 'mqtt-broker-input',
        inputType: 'text',
        placeholder: 'mqtt://localhost:1883',
        ariaLabel: 'MQTT Broker URL',
        peerId: 'url-input'
    }
};

/**
 * Show or hide one of the protocol URL bars, creating it on first use.
 * @param {keyof MIRRORED_URL_SECTIONS} mode
 * @param {boolean} show
 */
function toggleMirroredUrlSection(mode, show) {
    const config = MIRRORED_URL_SECTIONS[mode];
    let section = document.getElementById(config.sectionId);

    if (show) {
        if (!section) {
            section = createMirroredUrlSection(config);
        }
        if (section) {
            syncMirroredUrlInput(config.inputId, config.peerId);
            section.style.display = 'flex';
        }
    } else if (section) {
        section.style.display = 'none';
    }
}

/**
 * Show or hide the gRPC URL section elements
 * @param {boolean} show
 */
function showGrpcUrlSection(show) {
    const grpcUrlSection = document.getElementById('grpc-url-section');

    if (grpcUrlSection) {
        grpcUrlSection.style.display = show ? 'flex' : 'none';
    }
}

/**
 * Show or hide the WebSocket URL section elements
 * @param {boolean} show
 */
function showWebSocketUrlSection(show) {
    toggleMirroredUrlSection('websocket', show);
}

function showSseUrlSection(show) {
    toggleMirroredUrlSection('sse', show);
}

function showGraphQLUrlSection(show) {
    toggleMirroredUrlSection('graphql', show);
}

function showMqttUrlSection(show) {
    toggleMirroredUrlSection('mqtt', show);
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
    setRequestMode(RequestMode.HTTP);
}
