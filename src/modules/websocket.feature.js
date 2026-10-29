/**
 * @fileoverview Feature descriptor wiring the WebSocket request tab: sub-protocols input and saved message presets
 * @module websocket.feature
 */

import { app } from './appContext.js';
import { WebSocketPresetList } from './websocket/websocketPresets.js';
import { PROTOCOLS_INPUT_ID } from './websocket/websocketFields.js';
import { RenameDialog } from './ui/RenameDialog.js';
import { toast } from './ui/Toast.js';
import { translate } from './utils/translate.js';
import { activateTab } from './tabManager.js';
import { markTabModified } from './state/tabModified.js';
import { scheduleEndpointSave } from './endpointSave.js';
import { setRequestBodyContent } from './requestBodyHelper.js';
import { getWebSocketBodyContent } from './websocketHandler.js';
import { sendWebSocketText } from './apiHandler.js';

/**
 * @param {string} defaultName
 * @returns {Promise<string|null>}
 */
function promptName(defaultName) {
    return new RenameDialog().show(defaultName, {
        title: translate('websocket.save_message_title', 'Save message'),
        label: translate('websocket.save_message_label', 'Name:'),
        confirmText: translate('websocket.save_message_confirm', 'Save')
    });
}

/** @returns {{mode: 'json'|'text', content: string}} */
function readComposer() {
    const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('body-mode-select'));
    return { mode: select?.value === 'text' ? 'text' : 'json', content: getWebSocketBodyContent() || '' };
}

/**
 * @param {{mode: 'json'|'text', content: string}} preset
 * @returns {void}
 */
function loadMessage({ mode, content }) {
    app.graphqlBodyManager?.switchMode(mode);
    if (mode === 'text') {
        app.requestBodyTextEditor?.setContent(content);
    } else {
        setRequestBodyContent(content);
    }
    activateTab('request', 'body');
    markTabModified();
}

/** @returns {void} */
function notifyChanged() {
    markTabModified();
    scheduleEndpointSave();
}

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const websocketFeature = {
    name: 'websocket',
    create() {
        const presets = new WebSocketPresetList({
            promptName,
            loadMessage,
            sendMessage: sendWebSocketText,
            readComposer,
            notifyChanged,
            warn: (message) => toast.warning(message)
        });
        return { presets };
    },
    globals: { websocketPresets: 'presets' },
    init({ presets }) {
        presets.initialize();
        const input = document.getElementById(PROTOCOLS_INPUT_ID);
        input?.addEventListener('input', () => markTabModified());
        input?.addEventListener('change', () => scheduleEndpointSave());
    }
};
