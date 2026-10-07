/**
 * @fileoverview MQTT request fields: defaults, normalisation and form read/write shared by every MQTT save/restore path
 * @module mqtt/mqttFields
 */

const MAX_KEEP_ALIVE_SECS = 65535;

export const MQTT_DEFAULTS = Object.freeze({
    clientId: '',
    username: '',
    password: '',
    subscribeTopic: '',
    publishTopic: '',
    qos: 0,
    retain: false,
    keepAlive: 60,
    cleanSession: true,
    willTopic: '',
    willPayload: '',
    willQos: 0,
    willRetain: false
});

/** @type {Object<string, {id: string, kind: ('text'|'secret'|'qos'|'number'|'check')}>} */
const FORM_FIELDS = Object.freeze({
    clientId: { id: 'mqtt-client-id-input', kind: 'text' },
    username: { id: 'mqtt-username-input', kind: 'secret' },
    password: { id: 'mqtt-password-input', kind: 'secret' },
    subscribeTopic: { id: 'mqtt-subscribe-input', kind: 'text' },
    publishTopic: { id: 'mqtt-topic-input', kind: 'text' },
    qos: { id: 'mqtt-qos-select', kind: 'qos' },
    retain: { id: 'mqtt-retain-checkbox', kind: 'check' },
    keepAlive: { id: 'mqtt-keepalive-input', kind: 'number' },
    cleanSession: { id: 'mqtt-clean-session-checkbox', kind: 'check' },
    willTopic: { id: 'mqtt-will-topic-input', kind: 'text' },
    willPayload: { id: 'mqtt-will-payload-input', kind: 'secret' },
    willQos: { id: 'mqtt-will-qos-select', kind: 'qos' },
    willRetain: { id: 'mqtt-will-retain-checkbox', kind: 'check' }
});

/**
 * @param {*} value
 * @returns {number}
 */
function toQos(value) {
    const qos = Number(value);
    return qos === 1 || qos === 2 ? qos : 0;
}

/**
 * @param {*} value
 * @returns {number}
 */
function toKeepAlive(value) {
    if (value === '' || value === null || value === undefined) {
        return MQTT_DEFAULTS.keepAlive;
    }
    const secs = Math.floor(Number(value));
    if (!Number.isFinite(secs)) {
        return MQTT_DEFAULTS.keepAlive;
    }
    return Math.min(Math.max(secs, 0), MAX_KEEP_ALIVE_SECS);
}

/**
 * @param {Object|null|undefined} data
 * @returns {typeof MQTT_DEFAULTS}
 */
export function normalizeMqttData(data) {
    const merged = { ...MQTT_DEFAULTS, ...(data || {}) };
    const normalized = {};
    for (const [key, field] of Object.entries(FORM_FIELDS)) {
        const value = merged[key];
        if (field.kind === 'qos') {
            normalized[key] = toQos(value);
        } else if (field.kind === 'number') {
            normalized[key] = toKeepAlive(value);
        } else if (field.kind === 'check') {
            normalized[key] = typeof value === 'boolean' ? value : MQTT_DEFAULTS[key];
        } else {
            normalized[key] = typeof value === 'string' ? value : String(value ?? '');
        }
    }
    return normalized;
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.trim]
 * @returns {typeof MQTT_DEFAULTS}
 */
export function readMqttForm({ trim = false } = {}) {
    const raw = {};
    for (const [key, field] of Object.entries(FORM_FIELDS)) {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(field.id));
        if (!el) {
            continue;
        }
        if (field.kind === 'check') {
            raw[key] = el.checked;
        } else if (field.kind === 'text' && trim) {
            raw[key] = el.value.trim();
        } else {
            raw[key] = el.value;
        }
    }
    return normalizeMqttData(raw);
}

/**
 * @param {Object|null|undefined} data
 */
export function writeMqttForm(data) {
    const values = normalizeMqttData(data);
    for (const [key, field] of Object.entries(FORM_FIELDS)) {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(field.id));
        if (!el) {
            continue;
        }
        if (field.kind === 'check') {
            el.checked = values[key];
        } else {
            el.value = String(values[key]);
        }
    }
}
