/**
 * @fileoverview Manages UI mode switching between HTTP, WebSocket, and gRPC requests
 * @module modules/requestModeManager
 */

import { app } from './appContext.js';
import { RequestMode, getProtocol, listProtocolIds, resolveProtocolId } from './protocols/protocolRegistry.js';
import { activateTab, setResponseTabsForProtocol } from './tabManager.js';
import { notifyStreamStateChanged } from './streaming/streamState.js';
import { createMirroredUrlSection, syncMirroredUrlInput } from './ui/mirroredUrlSection.js';

export { RequestMode };

/** @type {string} */
let currentMode = RequestMode.HTTP;

/** @returns {string} */
export function getCurrentMode() {
    return currentMode;
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
    notifyStreamStateChanged();
}

/** @param {string} mode */
function updateUIForMode(mode) {
    const descriptor = getProtocol(mode);
    const { ui } = descriptor;
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
    activateTab('request', tabId);
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
    const descriptor = getProtocol(protocolId);
    const config = descriptor.ui.urlSection;
    if (!config) {
        return;
    }

    const inputId = descriptor.urlInputId;
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
