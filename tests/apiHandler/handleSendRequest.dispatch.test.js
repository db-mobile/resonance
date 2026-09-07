/* global document, window */
/** @fileoverview Characterization tests for handleSendRequest's protocol dispatch. */

import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

const handlers = {
    websocket: jest.fn(),
    sse: jest.fn(),
    mqtt: jest.fn(),
    grpc: jest.fn()
};

async function loadApiHandler({ resolveVariablesError = null } = {}) {
    document.body.innerHTML = requestBarMarkup() + requestFormMarkup();
    jest.resetModules();
    Object.values(handlers).forEach(fn => fn.mockReset());

    jest.doMock('../../src/modules/collectionManager.js', () => ({
        saveAllRequestModifications: jest.fn().mockResolvedValue(undefined),
        saveRequestToCollection: jest.fn(),
        getCollections: jest.fn().mockResolvedValue([])
    }));
    jest.doMock('../../src/modules/websocketHandler.js', () => ({
        handleWebSocketSend: handlers.websocket,
        handleWebSocketCancel: jest.fn()
    }));
    jest.doMock('../../src/modules/sseHandler.js', () => ({
        handleSseConnect: handlers.sse,
        handleSseCancel: jest.fn()
    }));
    jest.doMock('../../src/modules/mqttHandler.js', () => ({
        handleMqttSend: handlers.mqtt,
        handleMqttCancel: jest.fn()
    }));
    jest.doMock('../../src/modules/grpcHandler.js', () => ({
        handleGrpcSend: handlers.grpc
    }));

    if (!resolveVariablesError) {
        jest.dontMock('../../src/modules/services/RequestBuilderService.js');
    } else {
        jest.doMock('../../src/modules/services/RequestBuilderService.js', () => ({
            RequestBuilderService: class {
                async resolveVariables() {
                    throw new Error(resolveVariablesError);
                }
                mergeAuthData() {}
                processRequestComponents() {
                    return { url: '', queryString: '', pathParams: {} };
                }
            }
        }));
    }

    const apiHandler = await import('../../src/modules/apiHandler.js');
    const { setRequestMode } = await import('../../src/modules/requestModeManager.js');
    const { authManager } = await import('../../src/modules/authManager.js');
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');

    initTabListeners();

    window.backendAPI = {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({}) },
        sendApiRequest: jest.fn().mockResolvedValue({ status: 200, headers: {}, body: '' })
    };

    setCurrentEndpoint(null);

    return { ...apiHandler, setRequestMode, authManager };
}

function urlOf(mock) {
    return mock.mock.calls[0][0];
}

afterEach(() => {
    document.body.innerHTML = '';
    delete window.backendAPI;
});

describe('handleSendRequest dispatches to exactly one protocol handler', () => {
    const cases = [
        ['websocket', 'websocket'],
        ['sse', 'sse'],
        ['mqtt', 'mqtt'],
        ['grpc', 'grpc']
    ];

    test.each(cases)('%s mode calls only its own handler', async (mode, handlerKey) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode(mode);

        await handleSendRequest();

        expect(handlers[handlerKey]).toHaveBeenCalledTimes(1);
        for (const [key, fn] of Object.entries(handlers)) {
            if (key !== handlerKey) {
                expect(fn).not.toHaveBeenCalled();
            }
        }
    });
});

describe('each streaming protocol reads its URL differently', () => {
    test('WebSocket prefers its own mirror over the shared input', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('websocket');

        document.getElementById('url-input').value = 'wss://peer.example';
        document.getElementById('websocket-url-input').value = 'wss://mirror.example';

        await handleSendRequest();

        expect(urlOf(handlers.websocket)).toBe('wss://mirror.example');
    });

    test('WebSocket falls back to the value attribute when the property is empty', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('websocket');

        const input = document.getElementById('url-input');
        input.value = '';
        input.setAttribute('value', 'wss://attribute.example');

        await handleSendRequest();

        expect(urlOf(handlers.websocket)).toBe('wss://attribute.example');
    });

    test('SSE prefers its own mirror over the shared input', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('sse');

        document.getElementById('url-input').value = 'https://peer.example/events';
        document.getElementById('sse-url-input').value = 'https://mirror.example/events';

        await handleSendRequest();

        expect(urlOf(handlers.sse)).toBe('https://mirror.example/events');
    });

    test('MQTT prefers the broker input over the shared input', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('mqtt');

        document.getElementById('url-input').value = 'mqtt://peer:1883';
        document.getElementById('mqtt-broker-input').value = 'mqtt://broker:1883';

        await handleSendRequest();

        expect(urlOf(handlers.mqtt)).toBe('mqtt://broker:1883');
    });
});

describe('the send-in-progress bracket', () => {
    test.each(['websocket', 'sse', 'mqtt'])('%s clears it after the handler resolves', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode(mode);

        await handleSendRequest();

        expect(document.getElementById('send-request-btn').style.display).not.toBe('none');
        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    });

    test.each(['websocket', 'sse', 'mqtt'])('%s clears it even when the handler rejects', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode(mode);
        handlers[mode].mockRejectedValue(new Error('connection refused'));

        await expect(handleSendRequest()).rejects.toThrow('connection refused');

        expect(document.getElementById('send-request-btn').style.display).not.toBe('none');
        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    });

    test('the button is hidden while the handler is in flight', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('websocket');

        let displayDuringSend;
        handlers.websocket.mockImplementation(() => {
            displayDuringSend = document.getElementById('send-request-btn').style.display;
            return Promise.resolve();
        });

        await handleSendRequest();

        expect(displayDuringSend).toBe('none');
    });
});

describe('a variable-processing failure stops the send', () => {
    test.each(['websocket', 'sse', 'mqtt'])('%s reports it and never calls the handler', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({
            resolveVariablesError: 'bad template'
        });
        setRequestMode(mode);

        await handleSendRequest();

        expect(handlers[mode]).not.toHaveBeenCalled();
        expect(document.getElementById('status-display').textContent)
            .toContain('Variable processing error: bad template');
    });

    test.each(['websocket', 'sse', 'mqtt'])('%s never enters the in-progress bracket', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({
            resolveVariablesError: 'bad template'
        });
        setRequestMode(mode);

        await handleSendRequest();

        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    });
});

describe('MQTT passes its whole connection record through', () => {
    test('sends the eight broker options, coercing a blank QoS to 0', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('mqtt');

        document.getElementById('mqtt-broker-input').value = 'mqtt://broker:1883';
        document.getElementById('mqtt-client-id-input').value = 'client-1';
        document.getElementById('mqtt-username-input').value = 'user';
        document.getElementById('mqtt-password-input').value = 'pass';
        document.getElementById('mqtt-subscribe-input').value = 'sub/topic';
        document.getElementById('mqtt-topic-input').value = 'pub/topic';
        const qos = document.getElementById('mqtt-qos-select');
        qos.innerHTML = '<option value="">--</option>';
        qos.value = '';

        await handleSendRequest();

        expect(handlers.mqtt.mock.calls[0][1]).toEqual({
            clientId: 'client-1',
            username: 'user',
            password: 'pass',
            subscribeTopic: 'sub/topic',
            publishTopic: 'pub/topic',
            qos: 0,
            payload: ''
        });
    });

    test('never reads the auth config', async () => {
        const { handleSendRequest, setRequestMode, authManager } = await loadApiHandler();
        const getAuthConfig = jest.spyOn(authManager, 'getAuthConfig');
        setRequestMode('mqtt');

        await handleSendRequest();

        expect(getAuthConfig).not.toHaveBeenCalled();
        getAuthConfig.mockRestore();
    });
});

describe('SSE carries the method and body', () => {
    test('passes the selected method through', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('sse');

        document.getElementById('sse-url-input').value = 'https://example.com/events';
        document.getElementById('method-select').value = 'POST';

        await handleSendRequest();

        expect(handlers.sse.mock.calls[0][2]).toMatchObject({ method: 'POST' });
    });

    test('reports an unparseable JSON body without connecting', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        const { toast } = await import('../../src/modules/ui/Toast.js');
        const toastError = jest.spyOn(toast, 'error').mockImplementation(() => {});
        setRequestMode('sse');

        document.getElementById('sse-url-input').value = 'https://example.com/events';
        document.getElementById('method-select').value = 'POST';
        document.querySelector('.body-mode-panel[data-mode="json"]').innerHTML =
            '<textarea id="body-input">{ not json</textarea>';

        await handleSendRequest();

        expect(handlers.sse).not.toHaveBeenCalled();
        expect(toastError).toHaveBeenCalled();
        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
        toastError.mockRestore();
    });

    test('defaults to GET, which carries no body', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('sse');

        document.getElementById('sse-url-input').value = 'https://example.com/events';

        await handleSendRequest();

        expect(handlers.sse.mock.calls[0][2]).toMatchObject({ method: 'GET', body: null });
    });
});
