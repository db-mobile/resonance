/* global document */
import { MQTT_DEFAULTS, normalizeMqttData, readMqttForm, writeMqttForm } from '../../src/modules/mqtt/mqttFields.js';

const FORM = `
    <input id="mqtt-client-id-input" />
    <input id="mqtt-username-input" />
    <input id="mqtt-password-input" type="password" />
    <input id="mqtt-subscribe-input" />
    <input id="mqtt-topic-input" />
    <select id="mqtt-qos-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select>
    <input id="mqtt-retain-checkbox" type="checkbox" />
    <input id="mqtt-keepalive-input" type="number" />
    <input id="mqtt-clean-session-checkbox" type="checkbox" checked />
    <input id="mqtt-will-topic-input" />
    <input id="mqtt-will-payload-input" />
    <select id="mqtt-will-qos-select"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select>
    <input id="mqtt-will-retain-checkbox" type="checkbox" />
`;

describe('normalizeMqttData', () => {
    test('data saved before the session options existed gets the defaults', () => {
        const legacy = { clientId: 'c', username: 'u', subscribeTopic: 's/#', publishTopic: 'p', qos: 2 };

        expect(normalizeMqttData(legacy)).toEqual({ ...MQTT_DEFAULTS, ...legacy });
    });

    test('null data is all defaults', () => {
        expect(normalizeMqttData(null)).toEqual(MQTT_DEFAULTS);
    });

    test('QoS outside 0-2 falls back to 0 and numeric strings are coerced', () => {
        expect(normalizeMqttData({ qos: '1', willQos: 7 })).toMatchObject({ qos: 1, willQos: 0 });
    });

    test('keep-alive is clamped to the wire range and blank means the default', () => {
        expect(normalizeMqttData({ keepAlive: -5 }).keepAlive).toBe(0);
        expect(normalizeMqttData({ keepAlive: 999999 }).keepAlive).toBe(65535);
        expect(normalizeMqttData({ keepAlive: '' }).keepAlive).toBe(60);
        expect(normalizeMqttData({ keepAlive: 'abc' }).keepAlive).toBe(60);
        expect(normalizeMqttData({ keepAlive: '30' }).keepAlive).toBe(30);
    });

    test('non-boolean switches fall back to their defaults', () => {
        expect(normalizeMqttData({ cleanSession: 'no', retain: 1 })).toMatchObject({ cleanSession: true, retain: false });
    });

    test('unknown keys are dropped', () => {
        expect(normalizeMqttData({ extra: 1 })).not.toHaveProperty('extra');
    });
});

describe('MQTT form read/write', () => {
    beforeEach(() => {
        document.body.innerHTML = FORM;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('a written record reads back unchanged', () => {
        const record = {
            clientId: 'dev-1',
            username: 'user',
            password: ' secret ',
            subscribeTopic: 'a/#',
            publishTopic: 'a/b',
            qos: 1,
            retain: true,
            keepAlive: 15,
            cleanSession: false,
            willTopic: 'a/status',
            willPayload: 'offline',
            willQos: 2,
            willRetain: true
        };

        writeMqttForm(record);

        expect(readMqttForm()).toEqual(record);
    });

    test('trim applies to topics and client id but not to secrets or the will payload', () => {
        document.getElementById('mqtt-client-id-input').value = '  dev-1 ';
        document.getElementById('mqtt-topic-input').value = ' a/b ';
        document.getElementById('mqtt-will-topic-input').value = ' w ';
        document.getElementById('mqtt-password-input').value = ' pw ';
        document.getElementById('mqtt-will-payload-input').value = ' bye ';

        expect(readMqttForm({ trim: true })).toMatchObject({
            clientId: 'dev-1',
            publishTopic: 'a/b',
            willTopic: 'w',
            password: ' pw ',
            willPayload: ' bye '
        });
    });

    test('missing elements read as defaults', () => {
        document.body.innerHTML = '';

        expect(readMqttForm()).toEqual(MQTT_DEFAULTS);
    });
});
