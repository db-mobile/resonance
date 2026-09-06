/**
 * @fileoverview Manages UI mode switching between HTTP, WebSocket, and gRPC requests
 * @module modules/requestModeManager
 */

import { app } from './appContext.js';
import { PROTOCOLS, RequestMode, getProtocol, listProtocolIds, resolveProtocolId } from './protocols/protocolRegistry.js';
import { setResponseTabsForProtocol } from './tabManager.js';
import { createMirroredUrlSection, syncMirroredUrlInput } from './ui/mirroredUrlSection.js';

export { RequestMode };

/** @type {string} */
let currentMode = RequestMode.HTTP;

const MODE_UI = Object.freeze({
    [RequestMode.HTTP]: Object.freeze({
        urlSection: null,
        showBodyModeSelector: true,
        forceBodyMode: null,
        lockBodyMode: false,
        workbench: null
    }),
    [RequestMode.GRPC]: Object.freeze({
        urlSection: Object.freeze({ sectionId: 'grpc-url-section' }),
        showBodyModeSelector: true,
        forceBodyMode: null,
        lockBodyMode: false,
        workbench: null
    }),
    [RequestMode.SSE]: Object.freeze({
        urlSection: Object.freeze({
            sectionId: 'sse-url-section',
            method: 'SSE',
            label: 'SSE',
            inputType: 'url',
            placeholder: 'https://example.com/events',
            ariaLabel: 'SSE URL',
            peerId: 'url-input',
            syncQueryParams: true
        }),
        showBodyModeSelector: true,
        forceBodyMode: null,
        lockBodyMode: false,
        workbench: null
    }),
    [RequestMode.WEBSOCKET]: Object.freeze({
        urlSection: Object.freeze({
            sectionId: 'websocket-url-section',
            method: 'WS',
            label: 'WS',
            inputType: 'url',
            placeholder: 'wss://echo.websocket.events',
            ariaLabel: 'WebSocket URL',
            peerId: 'url-input',
            syncQueryParams: true
        }),
        showBodyModeSelector: false,
        forceBodyMode: 'json',
        lockBodyMode: true,
        workbench: 'off'
    }),
    [RequestMode.MQTT]: Object.freeze({
        urlSection: Object.freeze({
            sectionId: 'mqtt-url-section',
            method: 'MQTT',
            label: 'MQTT',
            inputType: 'text',
            placeholder: 'mqtt://localhost:1883',
            ariaLabel: 'MQTT Broker URL',
            peerId: 'url-input'
        }),
        showBodyModeSelector: false,
        forceBodyMode: 'json',
        lockBodyMode: true,
        workbench: 'off'
    }),
    [RequestMode.GRAPHQL]: Object.freeze({
        urlSection: Object.freeze({
            sectionId: 'graphql-url-section',
            method: 'GRAPHQL',
            label: 'GraphQL',
            inputType: 'url',
            placeholder: 'https://api.example.com/graphql',
            ariaLabel: 'GraphQL Endpoint URL',
            peerId: 'url-input',
            syncQueryParams: true
        }),
        showBodyModeSelector: false,
        forceBodyMode: null,
        lockBodyMode: null,
        workbench: 'on',
        alwaysActivateDefaultTab: true
    })
});

/** @returns {string} */
export function getCurrentMode() {
    return currentMode;
}

/** @returns {boolean} */
export function isGrpcMode() {
    return currentMode === RequestMode.GRPC;
}

/** @returns {boolean} */
export function isWebSocketMode() {
    return currentMode === RequestMode.WEBSOCKET;
}

/** @returns {boolean} */
export function isSseMode() {
    return currentMode === RequestMode.SSE;
}

/** @returns {boolean} */
export function isMqttMode() {
    return currentMode === RequestMode.MQTT;
}

/** @returns {boolean} */
export function isGraphQLMode() {
    return currentMode === RequestMode.GRAPHQL;
}

/** @param {string} mode */
export function setRequestMode(mode) {
    const resolved = resolveProtocolId(mode);
    if (resolved !== mode) {
        console.warn(`Invalid request mode: ${mode}, defaulting to HTTP`);
    }

    currentMode = resolved;
    updateUIForMode(resolved);

    setResponseTabsForProtocol(resolved);
}

/** @param {string} mode */
function updateUIForMode(mode) {
    const descriptor = getProtocol(mode);
    const ui = MODE_UI[descriptor.id];
    const usesSharedUrlBar = ui.urlSection === null;

    const methodSelectContainer = document.querySelector('.method-select-container');
    const urlInput = document.getElementById('url-input');
    const urlInputContainer = urlInput?.closest('.url-autocomplete-wrapper') || urlInput;
    const curlBtn = document.getElementById('curl-btn');
    const bodyModeSelect = document.getElementById('body-mode-select');
    const bodyModeContainer = bodyModeSelect?.closest('.body-mode-selector-container');

    if (ui.workbench !== 'on' && app.graphqlBodyManager?.isGraphQLMode?.()) {
        app.graphqlBodyManager.setGraphQLModeEnabled(false);
    }

    setDisplay(methodSelectContainer, descriptor.needsMethod);
    setDisplay(urlInputContainer, usesSharedUrlBar);
    if (usesSharedUrlBar && urlInput && urlInput !== urlInputContainer
        && urlInput.style.display === 'none') {
        urlInput.style.display = '';
    }
    setDisplay(curlBtn, usesSharedUrlBar);

    for (const protocolId of listProtocolIds()) {
        toggleUrlSection(protocolId, protocolId === descriptor.id);
    }

    const visibleTabs = new Set(descriptor.requestTabs);
    document.querySelectorAll('.request-config .tab-nav .tab-button')
        .forEach(btn => setDisplay(btn, visibleTabs.has(btn.dataset.tab)));

    restrictBodyModes(descriptor.bodyModes);

    if (bodyModeSelect) {
        if (ui.forceBodyMode) {
            bodyModeSelect.value = ui.forceBodyMode;
        }
        if (ui.lockBodyMode !== null) {
            bodyModeSelect.disabled = ui.lockBodyMode;
        }
    }
    setDisplay(bodyModeContainer, ui.showBodyModeSelector);

    if (ui.workbench === 'off') {
        app.graphqlBodyManager?.setGraphQLModeEnabled(false);
    } else if (ui.workbench === 'on') {
        app.graphqlBodyManager?.setGraphQLModeEnabled(true);
    }

    const activeTab = document.querySelector('.request-config .tab-nav .tab-button.active');
    if (ui.alwaysActivateDefaultTab || !activeTab || !visibleTabs.has(activeTab.dataset.tab)) {
        activateRequestTab(descriptor.defaultTab);
    }
}

/**
 * @param {?HTMLElement} element
 * @param {boolean} show
 * @returns {void}
 */
function setDisplay(element, show) {
    if (element) {
        element.style.display = show ? '' : 'none';
    }
}

/**
 * @param {string} tabId
 * @returns {void}
 */
function activateRequestTab(tabId) {
    document.querySelector(`.request-config .tab-nav .tab-button[data-tab="${tabId}"]`)?.click();
}

/** @type {{value: string, text: string}[]|null} */
let bodyModeOptionTemplate = null;

/** @param {string[]|null} allowed */
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
 * @param {string} protocolId
 * @param {boolean} show
 * @returns {void}
 */
function toggleUrlSection(protocolId, show) {
    const config = MODE_UI[protocolId].urlSection;
    if (!config) {
        return;
    }

    const inputId = PROTOCOLS[protocolId].urlInputId;
    let section = document.getElementById(config.sectionId);

    if (show) {
        if (!section && config.method) {
            section = createMirroredUrlSection({ ...config, inputId });
        }
        if (section) {
            if (config.peerId) {
                syncMirroredUrlInput(inputId, config.peerId);
            }
            section.style.display = 'flex';
        }
    } else if (section) {
        section.style.display = 'none';
    }
}

export function initRequestModeManager() {
    setRequestMode(RequestMode.HTTP);
}
