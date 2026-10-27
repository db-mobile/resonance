/* global document, window */
/** @fileoverview Characterization tests for handleSendRequest's protocol dispatch. */

import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

const liveness = { websocket: jest.fn(() => false) };
const connectWebSocket = jest.fn();

const handlers = {
    websocket: jest.fn(),
    sse: jest.fn(),
    mqtt: jest.fn(),
    grpc: jest.fn()
};

const cancels = {
    websocket: jest.fn(),
    sse: jest.fn(),
    mqtt: jest.fn(),
    grpc: jest.fn()
};

async function loadApiHandler({ resolveVariablesError = null, variables = null } = {}) {
    document.body.innerHTML = requestBarMarkup() + requestFormMarkup();
    jest.resetModules();
    Object.values(handlers).forEach(fn => fn.mockReset());
    Object.values(cancels).forEach(fn => fn.mockReset());
    connectWebSocket.mockReset();
    liveness.websocket.mockReset().mockReturnValue(false);

    jest.doMock('../../src/modules/websocketHandler.js', () => ({
        getWebSocketBodyContent: jest.requireActual('../../src/modules/websocketHandler.js').getWebSocketBodyContent,
        handleWebSocketConnect: connectWebSocket,
        getWebSocketState: () => liveness.websocket() ? 'open' : 'closed',
        isWebSocketSending: () => false,
        handleWebSocketSend: handlers.websocket,
        handleWebSocketCancel: cancels.websocket,
        isWebSocketLive: liveness.websocket
    }));
    jest.doMock('../../src/modules/sseHandler.js', () => ({
        handleSseConnect: handlers.sse,
        handleSseCancel: cancels.sse,
        isSseLive: jest.fn(() => false)
    }));
    jest.doMock('../../src/modules/mqttHandler.js', () => ({
        handleMqttSend: handlers.mqtt,
        handleMqttCancel: cancels.mqtt
    }));
    jest.doMock('../../src/modules/grpcHandler.js', () => ({
        handleGrpcSend: handlers.grpc,
        handleGrpcCancel: cancels.grpc
    }));

    if (variables) {
        jest.doMock('../../src/modules/services/RequestBuilderService.js', () => {
            const { VariableProcessor } = jest.requireActual('../../src/modules/variables/VariableProcessor.js');
            return {
                RequestBuilderService: class {
                    async resolveVariables() {
                        return { variables, processor: new VariableProcessor() };
                    }
                    mergeAuthData() {}
                    processRequestComponents({ url }) {
                        return { url, queryString: '', pathParams: {} };
                    }
                }
            };
        });
    } else if (!resolveVariablesError) {
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
    const { AuthManager } = await import('../../src/modules/authManager.js');
    const authManager = new AuthManager({ typeSelect: null, fieldsContainer: null });
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');

    initTabListeners();

    window.backendAPI = {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({}) },
        sendApiRequest: jest.fn().mockResolvedValue({ status: 200, headers: {}, body: '' })
    };

    const { app } = await import('../../src/modules/appContext.js');
    app.authManager = authManager;
    app.workspaceTabController = { service: { getActiveTabId: jest.fn().mockResolvedValue('tab-1') } };
    const { installTestRequestPipeline } = await import('../helpers/requestPipeline.js');
    await installTestRequestPipeline(app, window.backendAPI);

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
        const { handleWebSocketConnectionAction, setRequestMode } = await loadApiHandler();
        setRequestMode('websocket');

        document.getElementById('url-input').value = 'wss://peer.example';
        document.getElementById('websocket-url-input').value = 'wss://mirror.example';

        await handleWebSocketConnectionAction();

        expect(connectWebSocket.mock.calls[0][0].url).toBe('wss://mirror.example');
    });

    test('WebSocket falls back to the value attribute when the property is empty', async () => {
        const { handleWebSocketConnectionAction, setRequestMode } = await loadApiHandler();
        setRequestMode('websocket');

        const input = document.getElementById('url-input');
        input.value = '';
        input.setAttribute('value', 'wss://attribute.example');

        await handleWebSocketConnectionAction();

        expect(connectWebSocket.mock.calls[0][0].url).toBe('wss://attribute.example');
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
        setRequestMode('sse');

        let displayDuringSend;
        handlers.sse.mockImplementation(() => {
            displayDuringSend = document.getElementById('send-request-btn').style.display;
            return Promise.resolve();
        });

        await handleSendRequest();

        expect(displayDuringSend).toBe('none');
    });
});

describe('a variable-processing failure stops the send', () => {
    test.each(['sse', 'mqtt'])('%s reports it and never calls the handler', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({
            resolveVariablesError: 'bad template'
        });
        setRequestMode(mode);

        await handleSendRequest();

        expect(handlers[mode]).not.toHaveBeenCalled();
        expect(document.getElementById('status-display').textContent)
            .toContain('Variable processing error: bad template');
    });

    test.each(['sse', 'mqtt'])('%s never enters the in-progress bracket', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({
            resolveVariablesError: 'bad template'
        });
        setRequestMode(mode);

        await handleSendRequest();

        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    });
});

describe('MQTT passes its whole connection record through', () => {
    test('sends every broker option, coercing a blank QoS to 0', async () => {
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
            retain: false,
            keepAlive: 60,
            cleanSession: true,
            willTopic: '',
            willPayload: '',
            willQos: 0,
            willRetain: false,
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
    test.each(['json', 'text'])('GET forwards a resolved %s body and default content type', async (mode) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({ variables: { id: '7' } });
        const { app } = await import('../../src/modules/appContext.js');
        setRequestMode('sse');
        document.getElementById('sse-url-input').value = 'https://example.com/events';
        document.getElementById('method-select').value = 'GET';
        document.getElementById('body-mode-select').value = mode;
        document.querySelector('.body-mode-panel[data-mode="json"]').innerHTML =
            '<textarea id="body-input">{"id":"{{id}}"}</textarea>';
        app.requestBodyTextEditor = { getContent: () => ' Grüße {{id}}\n' };

        await handleSendRequest();

        expect(handlers.sse.mock.calls[0][1]).toMatchObject({
            'Content-Type': mode === 'json' ? 'application/json' : 'text/plain'
        });
        expect(handlers.sse.mock.calls[0][2]).toMatchObject({
            method: 'GET', body: mode === 'json' ? '{"id":"7"}' : ' Grüße 7\n'
        });
    });

    test('passes the selected method through', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('sse');

        document.getElementById('sse-url-input').value = 'https://example.com/events';
        document.getElementById('method-select').value = 'POST';

        await handleSendRequest();

        expect(handlers.sse.mock.calls[0][2]).toMatchObject({ method: 'POST' });
    });

    test.each(['GET', 'DELETE', 'POST'])('%s reports an unparseable JSON body without connecting', async (method) => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        const { toast } = await import('../../src/modules/ui/Toast.js');
        const toastError = jest.spyOn(toast, 'error').mockImplementation(() => {});
        setRequestMode('sse');

        document.getElementById('sse-url-input').value = 'https://example.com/events';
        document.getElementById('method-select').value = method;
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

describe('streaming payloads resolve {{variables}}', () => {
    test('WebSocket sends the selected Text editor with whitespace and variables intact', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({ variables: { token: 'abc' } });
        const { app } = await import('../../src/modules/appContext.js');
        setRequestMode('websocket');
        document.getElementById('body-mode-select').value = 'text';
        app.requestBodyTextEditor = { getContent: () => '  {{token}}\n\n' };
        await handleSendRequest();
        const [body, tabId, prepare] = handlers.websocket.mock.calls[0];
        expect(body).toBe('  {{token}}\n\n');
        expect(tabId).toBe('tab-1');
        expect(await prepare(body)).toBe('  abc\n\n');
        expect(connectWebSocket).not.toHaveBeenCalled();
    });

    test('WebSocket sends the resolved message', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({ variables: { token: 'abc' } });
        setRequestMode('websocket');
        document.getElementById('websocket-url-input').value = 'wss://example.test';
        document.querySelector('.body-mode-panel[data-mode="json"]').innerHTML =
            '<textarea id="body-input">{"token":"{{token}}"}</textarea>';

        await handleSendRequest();

        const [body, tabId, prepare] = handlers.websocket.mock.calls[0];
        expect(tabId).toBe('tab-1');
        expect(await prepare(body)).toBe('{"token":"abc"}');
        expect(connectWebSocket).not.toHaveBeenCalled();
    });

    test('MQTT resolves topics, credentials and payload', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler({
            variables: { device: 'd1', user: 'u', pass: 'p' }
        });
        setRequestMode('mqtt');
        document.getElementById('mqtt-broker-input').value = 'mqtt://broker:1883';
        document.getElementById('mqtt-username-input').value = '{{user}}';
        document.getElementById('mqtt-password-input').value = '{{pass}}';
        document.getElementById('mqtt-subscribe-input').value = 'devices/{{device}}/#';
        document.getElementById('mqtt-topic-input').value = 'devices/{{device}}/cmd';

        await handleSendRequest();

        expect(handlers.mqtt.mock.calls[0][1]).toMatchObject({
            username: 'u',
            password: 'p',
            subscribeTopic: 'devices/d1/#',
            publishTopic: 'devices/d1/cmd'
        });
    });
});

describe('handleCancelRequest dispatches to exactly one protocol cancel', () => {
    test.each(['sse', 'mqtt'])('%s cancels its own stream and leaves the in-progress bracket', async (mode) => {
        const { handleSendRequest, handleCancelRequest, setRequestMode } = await loadApiHandler();
        setRequestMode(mode);
        handlers[mode].mockImplementation(() => new Promise(() => {}));
        handleSendRequest();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(document.getElementById('send-request-btn').style.display).toBe('none');

        await handleCancelRequest();

        expect(cancels[mode]).toHaveBeenCalledTimes(1);
        for (const [key, fn] of Object.entries(cancels)) {
            if (key !== mode) {
                expect(fn).not.toHaveBeenCalled();
            }
        }
        expect(document.getElementById('send-request-btn').style.display).not.toBe('none');
        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    });

    test('WebSocket cancels only its own connection', async () => {
        const { handleCancelRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('websocket');
        await handleCancelRequest();
        expect(cancels.websocket).toHaveBeenCalledTimes(1);
        expect(cancels.sse).not.toHaveBeenCalled();
    });

    test('grpc delegates to the gRPC cancel handler', async () => {
        const { handleCancelRequest, setRequestMode } = await loadApiHandler();
        setRequestMode('grpc');

        await handleCancelRequest();

        expect(cancels.grpc).toHaveBeenCalledTimes(1);
        expect(cancels.websocket).not.toHaveBeenCalled();
    });

    test('http with nothing in flight calls no protocol cancel and leaves the bridge alone', async () => {
        const { handleCancelRequest, setRequestMode } = await loadApiHandler();
        window.backendAPI.cancelApiRequest = jest.fn();
        setRequestMode('http');

        await handleCancelRequest();

        Object.values(cancels).forEach(fn => expect(fn).not.toHaveBeenCalled());
        expect(window.backendAPI.cancelApiRequest).not.toHaveBeenCalled();
    });
});

describe('a live stream keeps a Disconnect button', () => {
    test('the connection button shows Disconnect while open and Connect after closing', async () => {
        const { handleSendRequest, setRequestMode } = await loadApiHandler();
        const { STREAM_STATE_EVENT } = await import('../../src/modules/streaming/streamState.js');
        setRequestMode('websocket');
        document.getElementById('websocket-url-input').value = 'wss://example.test';
        liveness.websocket.mockReturnValue(true);

        await handleSendRequest();
        await new Promise(resolve => setTimeout(resolve, 0));

        const cancel = document.getElementById('websocket-connect-btn');
        expect(cancel.style.display).not.toBe('none');
        expect(cancel.textContent).toBe('Disconnect');

        liveness.websocket.mockReturnValue(false);
        document.dispatchEvent(new CustomEvent(STREAM_STATE_EVENT));
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(cancel.style.display).not.toBe('none');
        expect(cancel.textContent).toBe('Connect');
        expect(document.getElementById('send-request-btn').disabled).toBe(true);
    });

    test('HTTP mode never shows it', async () => {
        const { setRequestMode } = await loadApiHandler();
        liveness.websocket.mockReturnValue(true);
        setRequestMode('http');
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    });
});

