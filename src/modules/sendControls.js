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

/** @returns {Promise<void>} */
export async function refreshStreamControls() {
    if (requestInProgress || !cancelRequestBtn) {
        return;
    }
    const descriptor = getProtocol(getCurrentMode());
    const handler = getProtocolHandler(descriptor.id);
    const tabId = await getActiveTabId();
    if (requestInProgress) {
        return;
    }
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
