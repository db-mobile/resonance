/**
 * @fileoverview Send/cancel button state shared by the HTTP pipeline and every streaming protocol handler
 * @module sendControls
 */

import { sendRequestBtn, cancelRequestBtn } from './domElements.js';
import { app } from './appContext.js';
import { translate } from './utils/translate.js';
import { getCurrentMode } from './requestModeManager.js';
import { getProtocol, getProtocolHandler } from './protocols/protocolRegistry.js';
import { getActiveTabId } from './streaming/streamSession.js';
import { STREAM_STATE_EVENT } from './streaming/streamState.js';

let requestInProgress = false;

/**
 * @param {boolean} inProgress
 * @returns {void}
 */
export function setRequestInProgress(inProgress) {
    requestInProgress = inProgress;
    if (getCurrentMode() === 'websocket') {
        refreshStreamControls();
        app.statusBar?.setRequestRunning(inProgress);
        return;
    }
    if (inProgress) {
        sendRequestBtn.style.display = 'none';
        cancelRequestBtn.style.display = 'inline-block';
        setCancelButtonLabel(false);
        sendRequestBtn.disabled = true;
    } else {
        sendRequestBtn.style.display = 'inline-block';
        cancelRequestBtn.style.display = 'none';
        sendRequestBtn.disabled = false;
    }
    app.statusBar?.setRequestRunning(inProgress);
    if (!inProgress) {
        refreshStreamControls();
    }
}

/**
 * @param {boolean} disconnect
 * @returns {void}
 */
function setCancelButtonLabel(disconnect) {
    if (!cancelRequestBtn) {
        return;
    }
    const label = disconnect ? translate('request.disconnect', 'Disconnect') : translate('request.cancel', 'Cancel');
    cancelRequestBtn.textContent = label;
    cancelRequestBtn.setAttribute('aria-label', label);
}

let sendButtonOriginal = null;

/**
 * @param {boolean} active
 * @returns {void}
 */
function setSendButtonStop(active) {
    if (!sendRequestBtn || active === Boolean(sendButtonOriginal)) {
        return;
    }
    if (active) {
        sendButtonOriginal = { html: sendRequestBtn.innerHTML, title: sendRequestBtn.title };
        sendRequestBtn.innerHTML = 'Stop';
        sendRequestBtn.title = 'Stop subscription';
    } else {
        sendRequestBtn.innerHTML = sendButtonOriginal.html;
        sendRequestBtn.title = sendButtonOriginal.title;
        sendButtonOriginal = null;
    }
}

// Remember pre-existing disabled controls so unlocking does not enable unrelated controls.
const lockedControls = new Map();
function lockHandshake(locked) {
    for (const [control, disabled] of lockedControls) { control.disabled = disabled; }
    lockedControls.clear();
    const input = document.getElementById('websocket-url-input');
    if (input) { input.readOnly = locked; }
    for (const id of ['headers-list', 'query-params-list', 'add-header-btn', 'add-query-param-btn']) {
        const element = document.getElementById(id);
        if (!element) { continue; }
        element.inert = locked;
        if (!locked) { continue; }
        const controls = element.matches('button') ? [element] : element.querySelectorAll('input, textarea, select, button');
        for (const control of controls) {
            lockedControls.set(control, control.disabled);
            control.disabled = true;
        }
    }
}

let refreshVersion = 0;
/** @returns {Promise<void>} */
export async function refreshStreamControls() {
    const version = ++refreshVersion;
    const mode = getCurrentMode();
    const connectionButton = document.getElementById('websocket-connect-btn');
    if (connectionButton) { connectionButton.style.display = mode === 'websocket' ? '' : 'none'; }
    if (mode !== 'websocket') { lockHandshake(false); }
    if ((requestInProgress && mode !== 'websocket') || !cancelRequestBtn) { return; }
    const descriptor = getProtocol(mode);
    const handler = getProtocolHandler(mode);
    const tabId = await getActiveTabId();
    if (version !== refreshVersion || mode !== getCurrentMode()) { return; }
    if (mode === 'websocket') {
        const state = handler?.connectionState?.(tabId) || 'closed';
        const labels = {
            closed: translate('request.connect', 'Connect'),
            connecting: translate('request.cancel', 'Cancel'),
            open: translate('request.disconnect', 'Disconnect'),
            closing: translate('request.disconnecting', 'Disconnecting…')
        };
        setSendButtonStop(false);
        sendRequestBtn.style.display = '';
        sendRequestBtn.disabled = state !== 'open' || Boolean(handler?.isSending?.(tabId));
        cancelRequestBtn.style.display = 'none';
        if (connectionButton) {
            connectionButton.textContent = labels[state];
            connectionButton.setAttribute('aria-label', labels[state]);
            connectionButton.disabled = state === 'closing';
            connectionButton.classList.toggle('suggested-action', state === 'closed');
            connectionButton.classList.toggle('destructive-action', state !== 'closed');
        }
        lockHandshake(state !== 'closed');
        return;
    }
    if (requestInProgress) { return; }
    sendRequestBtn.disabled = false;
    const live = Boolean(handler?.isLive(tabId));
    const cancelLive = live && descriptor.liveControl === 'cancel';
    cancelRequestBtn.style.display = cancelLive ? 'inline-block' : 'none';
    setCancelButtonLabel(cancelLive);
    setSendButtonStop(live && descriptor.liveControl === 'send');
}

if (typeof document !== 'undefined') {
    document.addEventListener(STREAM_STATE_EVENT, () => {
        refreshStreamControls();
    });
}

/**
 * @param {function(): Promise<*>} send
 * @returns {Promise<*>}
 */
export async function withRequestInProgress(send) {
    setRequestInProgress(true);
    try {
        return await send();
    } finally {
        setRequestInProgress(false);
    }
}
