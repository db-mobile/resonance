/* global window */
jest.mock('../../src/modules/apiHandler.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn(),
    clearResponseDisplayForTab: jest.fn()
}));

jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(),
    updateResponseTime: jest.fn(),
    updateResponseSize: jest.fn()
}));

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

import { displayResponseWithLineNumbersForTab } from '../../src/modules/apiHandler.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { app } from '../../src/modules/appContext.js';
import { initMqttHandler, handleMqttSend, clearMqttState } from '../../src/modules/mqttHandler.js';

describe('MQTT session options reach the backend', () => {
    const handlers = {};

    beforeAll(async () => {
        window.__TAURI_INTERNALS__ = {
            invoke: jest.fn(async (command, args) => {
                if (command === 'plugin:event|listen') {
                    handlers[args.event] = args.handler;
                }
            }),
            transformCallback: (fn) => fn
        };
        window.backendAPI = {
            mqtt: {
                connect: jest.fn().mockResolvedValue(undefined),
                publish: jest.fn().mockResolvedValue(undefined),
                close: jest.fn().mockResolvedValue(undefined)
            }
        };
        await initMqttHandler();
    });

    afterAll(() => {
        delete window.__TAURI_INTERNALS__;
        delete window.backendAPI;
        app.workspaceTabController = null;
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        app.workspaceTabController = { service: { getActiveTabId: jest.fn().mockResolvedValue('tab-o') } };
        await clearMqttState('tab-o');
        jest.clearAllMocks();
    });

    test('keep-alive, clean session and the will are sent on connect', async () => {
        await handleMqttSend('mqtt://broker.test', {
            clientId: 'dev-1',
            keepAlive: 15,
            cleanSession: false,
            willTopic: 'dev/1/status',
            willPayload: 'offline',
            willQos: 1,
            willRetain: true
        });

        expect(window.backendAPI.mqtt.connect).toHaveBeenCalledWith(expect.objectContaining({
            clientId: 'dev-1',
            keepAlive: 15,
            cleanSession: false,
            lastWill: { topic: 'dev/1/status', payload: 'offline', qos: 1, retain: true }
        }));
    });

    test('no will is sent when the will topic is empty', async () => {
        await handleMqttSend('mqtt://broker.test', { willPayload: 'ignored' });

        expect(window.backendAPI.mqtt.connect.mock.calls[0][0]).not.toHaveProperty('lastWill');
    });

    test('retain is passed to publish', async () => {
        await handleMqttSend('mqtt://broker.test', { publishTopic: 't', payload: 'x', retain: true });

        expect(window.backendAPI.mqtt.publish).toHaveBeenCalledWith(expect.objectContaining({ topic: 't', retain: true }));
    });

    test('a persistent session without a client ID is refused before connecting', async () => {
        const sent = await handleMqttSend('mqtt://broker.test', { cleanSession: false, clientId: '' });

        expect(sent).toBe(false);
        expect(toast.error).toHaveBeenCalled();
        expect(window.backendAPI.mqtt.connect).not.toHaveBeenCalled();
    });

    test('binary and retained messages are labelled in the log', async () => {
        await handleMqttSend('mqtt://broker.test', {});
        await handlers['mqtt-event']({ payload: { tabId: 'tab-o', broker: 'mqtt://broker.test', eventType: 'connect' } });
        await handlers['mqtt-event']({
            payload: {
                tabId: 'tab-o',
                broker: 'mqtt://broker.test',
                eventType: 'message',
                topic: 't/bin',
                message: '/wD+',
                encoding: 'base64',
                retain: true
            }
        });
        await new Promise((resolve) => setTimeout(resolve, 120));

        const rendered = displayResponseWithLineNumbersForTab.mock.calls.at(-1)[0];
        expect(rendered).toContain('RECEIVED t/bin (binary, 3 bytes, base64, retained)');
        expect(rendered).toContain('/wD+');
    });
});
