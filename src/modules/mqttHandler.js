import { clearResponseDisplayForTab } from './apiHandler.js';
import { getSettings } from './state/settingsCache.js';
import { app } from './appContext.js';
import { updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';
import { i18n } from '../i18n/index.js';
import {
    StreamSession,
    createBackendEventListener,
    getActiveTabId,
    isTabCurrentlyActive
} from './streaming/streamSession.js';

const session = new StreamSession({
    protocol: 'MQTT',
    buildResponseMeta: (entry, transcript, state) => ({
        data: transcript,
        headers: {},
        status: state === 'open' ? 101 : null,
        statusText: state === 'open' ? 'Connected' : '',
        ttfb: null,
        size: null,
        timings: null,
        cookies: [],
        mqtt: { broker: entry.broker || '', state }
    })
});

/**
 * @param {Object|null} entry
 * @param {boolean} [flash]
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
        void pill.offsetWidth;
        pill.classList.add('is-receiving');
    }
}

/**
 * @param {string} tabId
 * @param {boolean} [flash]
 */
async function updateMqttUiIfActive(tabId, flash = false) {
    if (await isTabCurrentlyActive(tabId)) {
        renderMqttStatus(session.get(tabId), flash);
    }
}

/**
 * @param {string} tabId
 * @returns {Promise<void>}
 */
export function refreshMqttConnectionUi(tabId) {
    return updateMqttUiIfActive(tabId);
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

/**
 * @param {string} broker
 * @returns {string}
 */
function mqttHostForCertLookup(broker) {
    return (broker || '')
        .trim()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .split(/[/?]/)[0]
        .toLowerCase();
}

/**
 * @param {string} broker
 * @returns {boolean}
 */
function isTlsBroker(broker) {
    return /^(mqtts|ssl|tls):\/\//i.test(broker || '');
}

/**
 * @param {string} normalizedBroker
 * @returns {Promise<Object|null>}
 */
async function buildMqttTlsOptions(normalizedBroker) {
    if (!isTlsBroker(normalizedBroker)) {
        return null;
    }

    let skipVerify = false;
    try {
        const settings = await getSettings();
        skipVerify = settings?.verifySsl === false;
    } catch {}

    const tls = { skipVerify };
    if (app.certificateController) {
        try {
            const cert = app.certificateController.getForHost(
                mqttHostForCertLookup(normalizedBroker)
            );
            if (cert) {
                tls.clientCert = cert;
            }
        } catch (_e) {
        }
    }
    return tls;
}

/**
 * @param {{payload: Object}} event
 * @returns {Promise<void>}
 */
async function handleBackendEvent(event) {
    const payload = event.payload || {};
    const { tabId, broker = '' } = payload;

    if (!tabId) {
        return;
    }

    const current = session.get(tabId);
    if (!current) {
        return;
    }

    if (current.broker && broker && current.broker !== broker && payload.eventType !== 'connect') {
        return;
    }

    if (payload.eventType === 'connect') {
        session.transition(tabId, current, { broker, state: 'open' });
        await session.updateStatus(tabId, 'MQTT connected', 101);
        await session.append(tabId, `CONNECTED ${broker}`);
        await updateMqttUiIfActive(tabId);
        return;
    }

    if (payload.eventType === 'message') {
        session.transition(tabId, current, {
            broker: current.broker || broker,
            state: 'open',
            messageCount: (current.messageCount || 0) + 1
        });
        await session.updateStatus(tabId, 'MQTT message received', 101);
        await session.append(tabId, receivedLabel(payload), payload.message || '');
        await updateMqttUiIfActive(tabId, true);
        return;
    }

    if (payload.eventType === 'disconnect') {
        session.transition(tabId, current, { broker, state: 'closed' });
        await session.updateStatus(tabId, 'MQTT disconnected', null);
        await session.append(tabId, 'DISCONNECTED');
        await updateMqttUiIfActive(tabId);
        return;
    }

    if (payload.eventType === 'error') {
        session.transition(tabId, current, { broker, state: current.state || 'closed' });
        await session.updateStatus(
            tabId,
            `MQTT error${payload.message ? `: ${payload.message}` : ''}`,
            null
        );
        await session.append(tabId, 'ERROR', payload.message || 'MQTT error');
        await updateMqttUiIfActive(tabId);
    }
}

/**
 * @param {string} base64
 * @returns {number}
 */
function decodedByteLength(base64) {
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor(base64.length * 3 / 4) - padding;
}

/**
 * @param {{topic?: string, message?: string, encoding?: string, retain?: boolean}} payload
 * @returns {string}
 */
function receivedLabel(payload) {
    const notes = [];
    if (payload.encoding === 'base64') {
        notes.push(`binary, ${decodedByteLength(payload.message || '')} bytes, base64`);
    }
    if (payload.retain) {
        notes.push('retained');
    }
    const topic = payload.topic ? ` ${payload.topic}` : '';
    const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : '';
    return `RECEIVED${topic}${suffix}`;
}

/**
 * @param {{willTopic?: string, willPayload?: string, willQos?: number, willRetain?: boolean}} options
 * @returns {{topic: string, payload: string, qos: number, retain: boolean}|null}
 */
function buildLastWill({ willTopic = '', willPayload = '', willQos = 0, willRetain = false }) {
    if (!willTopic) {
        return null;
    }
    return {
        topic: willTopic,
        payload: willPayload,
        qos: Number(willQos) || 0,
        retain: Boolean(willRetain)
    };
}

export const initMqttHandler = createBackendEventListener(
    'mqtt-event',
    () => !!window.backendAPI?.mqtt,
    handleBackendEvent
);

/**
 * @param {string} broker
 * @param {Object} options
 * @param {string} [options.clientId]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} [options.subscribeTopic]
 * @param {string} [options.publishTopic]
 * @param {number} [options.qos]
 * @param {boolean} [options.retain]
 * @param {number} [options.keepAlive]
 * @param {boolean} [options.cleanSession]
 * @param {string} [options.willTopic]
 * @param {string} [options.willPayload]
 * @param {number} [options.willQos]
 * @param {boolean} [options.willRetain]
 * @param {string} [options.payload]
 * @returns {Promise<boolean>}
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
        retain = false,
        keepAlive = 60,
        cleanSession = true,
        payload = ''
    } = options;

    if (!cleanSession && !clientId) {
        toast.error(i18n.t('mqtt.clean_session_needs_client_id'));
        return false;
    }

    const current = session.get(tabId);
    if (!current || current.broker !== normalizedBroker) {
        session.set(tabId, {
            broker: normalizedBroker,
            state: 'connecting',
            messageCount: 0,
            transcript: ''
        });
        clearResponseDisplayForTab(tabId);
    } else if (current.state !== 'open') {
        session.set(tabId, { ...current, state: 'connecting' });
    }

    if (session.get(tabId)?.state !== 'open') {
        await session.updateStatus(tabId, 'MQTT connecting...', null);
        await updateMqttUiIfActive(tabId);
    }

    const tls = await buildMqttTlsOptions(normalizedBroker);
    const connectRequest = {
        tabId,
        broker: normalizedBroker,
        clientId,
        username,
        password,
        subscribeTopic,
        qos: Number(qos) || 0,
        keepAlive,
        cleanSession
    };
    const lastWill = buildLastWill(options);
    if (lastWill) {
        connectRequest.lastWill = lastWill;
    }
    if (tls) {
        connectRequest.tls = tls;
    }

    try {
        await window.backendAPI.mqtt.connect(connectRequest);
    } catch (error) {
        toast.error(`MQTT connection failed: ${error.message || error}`);
        session.set(tabId, { ...(session.get(tabId) || {}), state: 'closed' });
        await updateMqttUiIfActive(tabId);
        return false;
    }

    if (subscribeTopic) {
        await session.append(tabId, `SUBSCRIBED ${subscribeTopic}`);
    }

    if (publishTopic) {
        try {
            await window.backendAPI.mqtt.publish({
                tabId,
                topic: publishTopic,
                payload,
                qos: Number(qos) || 0,
                retain
            });
            const retainedNote = retain ? ' (retained)' : '';
            await session.append(tabId, `PUBLISHED ${publishTopic}${retainedNote}`, payload || '');
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

    const current = session.get(tabId);
    const wasActive = current && current.state !== 'closed';

    await window.backendAPI.mqtt.close(tabId);

    if (wasActive) {
        session.set(tabId, { ...current, state: 'closed' });
        await session.updateStatus(tabId, 'MQTT disconnected', null);
        await session.append(tabId, 'DISCONNECTED');
    }
    await updateMqttUiIfActive(tabId);
    return true;
}

export async function clearMqttState(tabId) {
    if (window.backendAPI?.mqtt && tabId) {
        await window.backendAPI.mqtt.close(tabId);
    }
    session.remove(tabId);
}
