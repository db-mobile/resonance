import { clearResponseDisplayForTab, getSettingsCache } from './apiHandler.js';
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

/** @param {string} tabId */
export async function refreshMqttConnectionUi(tabId) {
    if (await isTabCurrentlyActive(tabId)) {
        renderMqttStatus(session.get(tabId));
    }
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
        const settings = getSettingsCache() || (await window.backendAPI.settings.get());
        skipVerify = settings?.verifySsl === false;
    } catch (_e) {
        void _e;
    }

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
        session.set(tabId, {
            ...current,
            broker,
            state: 'open',
            transcript: current.transcript || ''
        });
        await session.updateStatus(tabId, 'MQTT connected', 101);
        await session.append(tabId, `CONNECTED ${broker}`);
        await updateMqttUiIfActive(tabId);
        return;
    }

    if (payload.eventType === 'message') {
        session.set(tabId, {
            ...current,
            broker: current.broker || broker,
            state: 'open',
            messageCount: (current.messageCount || 0) + 1,
            transcript: current.transcript || ''
        });
        const topic = payload.topic ? ` ${payload.topic}` : '';
        await session.updateStatus(tabId, 'MQTT message received', 101);
        await session.append(tabId, `RECEIVED${topic}`, payload.message || '');
        await updateMqttUiIfActive(tabId, true);
        return;
    }

    if (payload.eventType === 'disconnect') {
        session.set(tabId, {
            ...current,
            broker,
            state: 'closed',
            transcript: current.transcript || ''
        });
        await session.updateStatus(tabId, 'MQTT disconnected', null);
        await session.append(tabId, 'DISCONNECTED');
        await updateMqttUiIfActive(tabId);
        return;
    }

    if (payload.eventType === 'error') {
        session.set(tabId, {
            ...current,
            broker,
            state: current.state || 'closed',
            transcript: current.transcript || ''
        });
        await session.updateStatus(
            tabId,
            `MQTT error${payload.message ? `: ${payload.message}` : ''}`,
            null
        );
        await session.append(tabId, 'ERROR', payload.message || 'MQTT error');
        await updateMqttUiIfActive(tabId);
    }
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
        payload = ''
    } = options;

    const current = session.get(tabId);
    if (!current || current.broker !== normalizedBroker) {
        session.set(tabId, {
            broker: normalizedBroker,
            state: 'connecting',
            messageCount: 0,
            transcript: ''
        });
        clearResponseDisplayForTab(tabId);
    } else {
        session.set(tabId, { ...current, state: 'connecting' });
    }

    await session.updateStatus(tabId, 'MQTT connecting...', null);
    await updateMqttUiIfActive(tabId);

    const tls = await buildMqttTlsOptions(normalizedBroker);
    const connectRequest = {
        tabId,
        broker: normalizedBroker,
        clientId,
        username,
        password,
        subscribeTopic,
        qos: Number(qos) || 0
    };
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
                qos: Number(qos) || 0
            });
            await session.append(tabId, `PUBLISHED ${publishTopic}`, payload || '');
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
