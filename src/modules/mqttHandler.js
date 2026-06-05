import { clearResponseDisplayForTab, displayResponseWithLineNumbersForTab } from './apiHandler.js';
import { updateResponseSize, updateResponseTime, updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';
import { i18n } from '../i18n/index.js';

const mqttState = new Map();
let mqttListenerPromise = null;

function getTimestamp() {
    return new Date().toLocaleTimeString();
}

/**
 * Render the MQTT connection indicator (status pill + Disconnect button) from a
 * tab's state entry. Only touches the DOM, which is shared by the active tab.
 * @param {Object|null} entry
 * @param {boolean} [flash] - briefly flash the pill (a message just arrived)
 */
function renderMqttStatus(entry, flash = false) {
    const pill = document.getElementById('mqtt-status-pill');
    const text = document.getElementById('mqtt-status-text');
    const btn = document.getElementById('mqtt-disconnect-btn');
    if (!pill || !text || !btn) {
        return;
    }

    const state = entry?.state || 'closed';

    if (state === 'open') {
        pill.dataset.state = 'connected';
        const count = entry?.messageCount || 0;
        text.textContent = count > 0
            ? i18n.t('mqtt.status_connected_count', { count })
            : i18n.t('mqtt.status_connected');
        btn.style.display = '';
    } else if (state === 'connecting') {
        pill.dataset.state = 'connecting';
        text.textContent = i18n.t('mqtt.status_connecting');
        btn.style.display = '';
    } else {
        pill.dataset.state = 'disconnected';
        text.textContent = i18n.t('mqtt.status_disconnected');
        btn.style.display = 'none';
    }

    if (flash) {
        pill.classList.remove('is-receiving');
        // Force reflow so the animation restarts on rapid successive messages.
        void pill.offsetWidth;
        pill.classList.add('is-receiving');
    }
}

/**
 * Update the indicator only when the given tab is the active one.
 * @param {string} tabId
 * @param {boolean} [flash]
 */
async function updateMqttUiIfActive(tabId, flash = false) {
    if (await isTabCurrentlyActive(tabId)) {
        renderMqttStatus(getMqttEntry(tabId), flash);
    }
}

/**
 * Re-sync the indicator to a tab's live connection state. Called when restoring
 * or switching into an MQTT tab so the pill/button reflect that tab.
 * @param {string} tabId
 */
export async function refreshMqttConnectionUi(tabId) {
    if (await isTabCurrentlyActive(tabId)) {
        renderMqttStatus(getMqttEntry(tabId));
    }
}

async function getActiveTabId() {
    return window.workspaceTabController
        ? window.workspaceTabController.service.getActiveTabId()
        : null;
}

async function isTabCurrentlyActive(tabId) {
    if (!tabId || !window.workspaceTabController) {
        return true;
    }

    const activeTabId = await window.workspaceTabController.service.getActiveTabId();
    return activeTabId === tabId;
}

function getMqttEntry(tabId) {
    return mqttState.get(tabId) || null;
}

function setMqttEntry(tabId, entry) {
    mqttState.set(tabId, entry);
}

function removeMqttEntry(tabId) {
    mqttState.delete(tabId);
}

function buildTranscriptEntry(label, content = '') {
    const header = `[${getTimestamp()}] ${label}`;
    return content ? `${header}\n${content}` : header;
}

async function persistTranscript(tabId, transcript, broker, state = 'closed') {
    if (!window.workspaceTabController || !tabId) {
        return;
    }

    const isOpen = state === 'open';
    await window.workspaceTabController.service.updateTab(tabId, {
        response: {
            data: transcript,
            headers: {},
            status: isOpen ? 101 : null,
            statusText: isOpen ? 'Connected' : '',
            ttfb: null,
            size: null,
            timings: null,
            cookies: [],
            mqtt: {
                broker,
                state
            }
        }
    });
}

async function appendTranscript(tabId, label, content = '', broker = '') {
    const current = getMqttEntry(tabId) || {};
    const entry = buildTranscriptEntry(label, content);
    const existing = current.transcript || '';
    const transcript = existing ? `${existing}\n\n${entry}` : entry;
    const state = current.state || 'closed';

    setMqttEntry(tabId, {
        ...current,
        transcript
    });

    displayResponseWithLineNumbersForTab(transcript, 'text/plain', tabId);
    await persistTranscript(tabId, transcript, broker || current.broker || '', state);
}

function normalizeMqttBroker(broker) {
    if (!broker) {
        return '';
    }

    if (/^mqtts?:\/\//i.test(broker) || /^(tcp|ssl|tls):\/\//i.test(broker)) {
        return broker;
    }

    return `mqtt://${broker}`;
}

async function updateStatusForTab(tabId, text, status = null) {
    if (await isTabCurrentlyActive(tabId)) {
        updateStatusDisplay(text, status);
        updateResponseTime(null);
        updateResponseSize(null);
    }
}

async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, broker = '' } = payload;
    const current = getMqttEntry(tabId) || {};

    if (!tabId) {
        return;
    }

    if (payload.eventType === 'connect') {
        setMqttEntry(tabId, {
            ...current,
            broker,
            state: 'open',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(tabId, 'MQTT connected', 101);
        await appendTranscript(tabId, `CONNECTED ${broker}`, '', broker);
        await updateMqttUiIfActive(tabId);
        return;
    }

    if (payload.eventType === 'message') {
        setMqttEntry(tabId, {
            ...current,
            broker: current.broker || broker,
            state: 'open',
            messageCount: (current.messageCount || 0) + 1,
            transcript: current.transcript || ''
        });
        const topic = payload.topic ? ` ${payload.topic}` : '';
        await updateStatusForTab(tabId, 'MQTT message received', 101);
        await appendTranscript(tabId, `RECEIVED${topic}`, payload.message || '', broker);
        await updateMqttUiIfActive(tabId, true);
        return;
    }

    if (payload.eventType === 'disconnect') {
        setMqttEntry(tabId, {
            ...current,
            broker,
            state: 'closed',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(tabId, 'MQTT disconnected', null);
        await appendTranscript(tabId, 'DISCONNECTED', '', broker);
        await updateMqttUiIfActive(tabId);
        return;
    }

    if (payload.eventType === 'error') {
        // Keep the current connection state — a terminal error is followed by a
        // 'disconnect' event, while publish/subscribe errors leave us connected.
        setMqttEntry(tabId, {
            ...current,
            broker,
            state: current.state || 'closed',
            transcript: current.transcript || ''
        });
        await updateStatusForTab(
            tabId,
            `MQTT error${payload.message ? `: ${payload.message}` : ''}`,
            null
        );
        await appendTranscript(tabId, 'ERROR', payload.message || 'MQTT error', broker);
        await updateMqttUiIfActive(tabId);
    }
}

export async function initMqttHandler() {
    if (mqttListenerPromise) {
        return mqttListenerPromise;
    }

    mqttListenerPromise = (async () => {
        if (!('__TAURI_INTERNALS__' in window) || !window.backendAPI?.mqtt) {
            return;
        }

        const { invoke, transformCallback } = window.__TAURI_INTERNALS__;
        await invoke('plugin:event|listen', {
            event: 'mqtt-event',
            target: { kind: 'Any' },
            handler: transformCallback(handleBackendEvent)
        });
    })();

    return mqttListenerPromise;
}

/**
 * Connect to an MQTT broker, subscribe to the configured topic, and optionally
 * publish a message.
 * @param {string} broker - Broker URL (mqtt:// or mqtts://)
 * @param {Object} options
 * @param {string} [options.clientId]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} [options.subscribeTopic]
 * @param {string} [options.publishTopic]
 * @param {number} [options.qos]
 * @param {string} [options.payload]
 * @returns {Promise<boolean>} true if a connection was established
 */
export async function handleMqttSend(broker, options = {}) {
    await initMqttHandler();

    if (!window.backendAPI?.mqtt) {
        toast.error('MQTT backend is not available');
        return false;
    }

    const tabId = await getActiveTabId();
    const normalizedBroker = normalizeMqttBroker(broker?.trim());

    if (!normalizedBroker) {
        toast.error('MQTT broker URL is required');
        return false;
    }

    const {
        clientId = '',
        username = '',
        password = '',
        subscribeTopic = '',
        publishTopic = '',
        qos = 0,
        payload = ''
    } = options;

    const current = getMqttEntry(tabId);
    if (!current || current.broker !== normalizedBroker) {
        setMqttEntry(tabId, {
            broker: normalizedBroker,
            state: 'connecting',
            messageCount: 0,
            transcript: ''
        });
        clearResponseDisplayForTab(tabId);
    } else {
        setMqttEntry(tabId, { ...current, state: 'connecting' });
    }

    await updateStatusForTab(tabId, 'MQTT connecting...', null);
    await updateMqttUiIfActive(tabId);

    try {
        await window.backendAPI.mqtt.connect({
            tabId,
            broker: normalizedBroker,
            clientId,
            username,
            password,
            subscribeTopic,
            qos: Number(qos) || 0
        });
    } catch (error) {
        toast.error(`MQTT connection failed: ${error.message || error}`);
        setMqttEntry(tabId, { ...(getMqttEntry(tabId) || {}), state: 'closed' });
        await updateMqttUiIfActive(tabId);
        return false;
    }

    if (subscribeTopic) {
        await appendTranscript(tabId, `SUBSCRIBED ${subscribeTopic}`, '', normalizedBroker);
    }

    if (publishTopic) {
        try {
            await window.backendAPI.mqtt.publish({
                tabId,
                topic: publishTopic,
                payload,
                qos: Number(qos) || 0
            });
            await appendTranscript(
                tabId,
                `PUBLISHED ${publishTopic}`,
                payload || '',
                normalizedBroker
            );
        } catch (error) {
            toast.error(`MQTT publish failed: ${error.message || error}`);
        }
    }

    return true;
}

export async function handleMqttCancel() {
    const tabId = await getActiveTabId();

    if (!window.backendAPI?.mqtt) {
        updateStatusDisplay('MQTT backend is not available', null);
        return false;
    }

    const current = getMqttEntry(tabId);
    const wasActive = current && current.state !== 'closed';

    await window.backendAPI.mqtt.close(tabId);

    if (wasActive) {
        setMqttEntry(tabId, { ...current, state: 'closed' });
        await updateStatusForTab(tabId, 'MQTT disconnected', null);
        await appendTranscript(tabId, 'DISCONNECTED', '');
    }
    await updateMqttUiIfActive(tabId);
    return true;
}

export async function clearMqttState(tabId) {
    if (window.backendAPI?.mqtt && tabId) {
        await window.backendAPI.mqtt.close(tabId);
    }
    removeMqttEntry(tabId);
}
