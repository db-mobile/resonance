/* global document, window */

const GRPC_MARKUP = `
    <div class="grpc-source-cards">
        <article class="grpc-source-card" data-source="reflection">
            <span id="grpc-connection-status" data-state="idle"></span>
            <input id="grpc-target-input" type="text" aria-label="gRPC Target">
            <input id="grpc-tls-checkbox" type="checkbox">
        </article>
        <article class="grpc-source-card" data-source="proto">
            <span id="grpc-proto-status" data-state="idle"></span>
            <span id="grpc-proto-filename"></span>
            <button id="grpc-clear-proto-btn" style="display: none;"></button>
        </article>
    </div>
    <select id="grpc-service-select"></select>
    <select id="grpc-method-select"></select>
    <span id="grpc-method-kind-badge" data-kind=""></span>
    <textarea id="grpc-body-input"></textarea>
    <div id="grpc-metadata-list" class="key-value-list" role="group"></div>
    <span id="status-display"></span>
`;

/**
 * The gRPC panel elements are resolved at module import time, so the markup has to
 * exist before the module graph is (re)loaded. apiHandler is stubbed because
 * importing it auto-initialises the collection controller, which needs the whole
 * app shell in the DOM.
 */
async function loadGrpcHandler(markup = GRPC_MARKUP) {
    document.body.innerHTML = markup;
    jest.resetModules();
    jest.doMock('../src/modules/apiHandler.js', () => ({
        displayResponseWithLineNumbersForTab: jest.fn(),
        generateEffectiveAuthData: jest.fn(async () => ({ headers: {}, queryParams: {} })),
        getRequestBuilderService: jest.fn(),
        getSettingsCache: jest.fn(() => ({})),
        warnUnresolvedVariables: jest.fn()
    }));
    return import('../src/modules/grpcHandler.js');
}

/**
 * Load the handler with a real RequestBuilderService (so variable resolution and
 * auth merging behave exactly as in the app) and a stubbed gRPC backend.
 * @param {Object} options - {variables, authData}
 * @returns {Promise<Object>} {module, invokeUnary}
 */
async function loadGrpcHandlerForSend({ variables = {}, authData = { headers: {}, queryParams: {} } } = {}) {
    document.body.innerHTML = GRPC_MARKUP;
    jest.resetModules();

    const { RequestBuilderService } = await import('../src/modules/services/RequestBuilderService.js');
    const variableService = {
        getVariables: async () => variables,
        getVariablesForCollection: async () => variables
    };
    const builder = new RequestBuilderService(() => variableService, () => ({}));

    jest.doMock('../src/modules/apiHandler.js', () => ({
        displayResponseWithLineNumbersForTab: jest.fn(),
        generateEffectiveAuthData: jest.fn(async () => authData),
        getRequestBuilderService: jest.fn(() => builder),
        getSettingsCache: jest.fn(() => ({})),
        warnUnresolvedVariables: jest.fn()
    }));

    const invokeUnary = jest.fn(async () => ({ success: true, data: {}, headers: {}, trailers: {} }));
    window.backendAPI = { grpc: { invokeUnary } };

    return { module: await import('../src/modules/grpcHandler.js'), invokeUnary };
}

describe('gRPC send path', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        delete window.backendAPI;
    });

    it('resolves variables in the target, message and metadata', async () => {
        const { module, invokeUnary } = await loadGrpcHandlerForSend({
            variables: { host: 'localhost:50051', token: 'secret', name: 'world' }
        });

        module.applyGrpcState({
            target: '{{host}}',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{"name": "{{name}}"}',
            metadata: { 'x-token': '{{token}}' },
            useTls: false
        });

        await module.handleGrpcSend();

        expect(invokeUnary).toHaveBeenCalledTimes(1);
        const request = invokeUnary.mock.calls[0][0];
        expect(request.target).toBe('localhost:50051');
        expect(request.requestJson).toEqual({ name: 'world' });
        expect(request.metadata['x-token']).toBe('secret');
    });

    it('folds Authorization into metadata with a lowercased key', async () => {
        const { module, invokeUnary } = await loadGrpcHandlerForSend({
            variables: { token: 'secret' },
            authData: { headers: { Authorization: 'Bearer {{token}}' }, queryParams: {} }
        });

        module.applyGrpcState({
            target: 'localhost:50051',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{}',
            metadata: { 'X-Upper': 'kept' },
            useTls: false
        });

        await module.handleGrpcSend();

        const { metadata } = invokeUnary.mock.calls[0][0];
        expect(metadata.authorization).toBe('Bearer secret');
        expect(metadata.Authorization).toBeUndefined();
        expect(metadata['x-upper']).toBe('kept');
    });

    it('does not send when the message is not valid JSON', async () => {
        const { module, invokeUnary } = await loadGrpcHandlerForSend();

        module.applyGrpcState({
            target: 'localhost:50051',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{not json',
            metadata: {},
            useTls: false
        });

        await module.handleGrpcSend();

        expect(invokeUnary).not.toHaveBeenCalled();
    });
});

describe('gRPC metadata rows', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        delete window.__pwned;
    });

    it('renders hostile keys and values as inert text, not markup', async () => {
        const { setGrpcMetadata, getGrpcMetadata } = await loadGrpcHandler();

        const metadata = {
            'x-quote': 'a" onfocus="window.__pwned=1',
            'x-markup': '<img src=q onerror="window.__pwned=1">'
        };
        setGrpcMetadata(metadata);

        const list = document.getElementById('grpc-metadata-list');
        expect(list.querySelector('img')).toBeNull();
        expect(window.__pwned).toBeUndefined();
        expect(getGrpcMetadata()).toEqual(metadata);
    });

    it('uses the shared key/value row so the remove control is the standard icon button', async () => {
        const { setGrpcMetadata } = await loadGrpcHandler();

        setGrpcMetadata({ 'x-request-id': 'abc' });

        const removeBtn = document.querySelector('#grpc-metadata-list .remove-row-btn');
        expect(removeBtn).not.toBeNull();
        expect(removeBtn.textContent.trim()).toBe('');
        expect(removeBtn.querySelector('.icon')).not.toBeNull();
    });

    it('skips rows with no key', async () => {
        const { setGrpcMetadata, getGrpcMetadata } = await loadGrpcHandler();

        setGrpcMetadata({ 'x-kept': 'yes', '': 'dropped' });

        expect(getGrpcMetadata()).toEqual({ 'x-kept': 'yes' });
    });
});

describe('gRPC state capture and restore', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('round-trips a reflection request without contacting the server', async () => {
        const { applyGrpcState, captureGrpcState } = await loadGrpcHandler();

        const saved = {
            target: 'localhost:50051',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{\n  "name": "world"\n}',
            metadata: { 'x-request-id': 'abc' },
            useTls: true,
            protoPath: null,
            clientStreaming: false,
            serverStreaming: false
        };

        applyGrpcState(saved);

        expect(captureGrpcState()).toEqual(saved);
    });

    it('restores the selected service and method as real options', async () => {
        const { applyGrpcState } = await loadGrpcHandler();

        applyGrpcState({
            target: 'localhost:50051',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{}',
            metadata: {},
            useTls: false
        });

        const serviceSelect = document.getElementById('grpc-service-select');
        const methodSelect = document.getElementById('grpc-method-select');

        expect(serviceSelect.options).toHaveLength(1);
        expect(serviceSelect.value).toBe('helloworld.Greeter');
        expect(methodSelect.options).toHaveLength(1);
        expect(methodSelect.value).toBe('/helloworld.Greeter/SayHello');
    });

    it('rehydrates streaming flags so a restored stream is not sent as unary', async () => {
        const { applyGrpcState, captureGrpcState } = await loadGrpcHandler();

        applyGrpcState({
            target: 'localhost:50051',
            service: 'chat.Chat',
            fullMethod: '/chat.Chat/Converse',
            requestJson: '{}',
            metadata: {},
            useTls: false,
            clientStreaming: true,
            serverStreaming: true
        });

        expect(document.getElementById('grpc-method-kind-badge').textContent).toBe('bidi');

        const captured = captureGrpcState();
        expect(captured.clientStreaming).toBe(true);
        expect(captured.serverStreaming).toBe(true);
    });

    it('restores proto mode and marks the proto card active', async () => {
        const { applyGrpcState, captureGrpcState } = await loadGrpcHandler();

        applyGrpcState({
            target: 'localhost:50051',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{}',
            metadata: {},
            useTls: false,
            protoPath: '/home/user/protos/greeter.proto'
        });

        expect(captureGrpcState().protoPath).toBe('/home/user/protos/greeter.proto');
        expect(document.getElementById('grpc-proto-filename').textContent).toBe('greeter.proto');
        expect(document.querySelector('[data-source="proto"]').dataset.active).toBe('true');
        expect(document.querySelector('[data-source="reflection"]').dataset.active).toBe('false');
    });

    it('marks the reflection card active when no proto is in play', async () => {
        const { applyGrpcState } = await loadGrpcHandler();

        applyGrpcState({
            target: 'localhost:50051',
            service: 'helloworld.Greeter',
            fullMethod: '/helloworld.Greeter/SayHello',
            requestJson: '{}',
            metadata: {},
            useTls: false,
            protoPath: null
        });

        expect(document.querySelector('[data-source="reflection"]').dataset.active).toBe('true');
        expect(document.querySelector('[data-source="proto"]').dataset.active).toBe('false');
        expect(document.getElementById('grpc-clear-proto-btn').style.display).toBe('none');
    });

    it('restores the target into the single shared target input', async () => {
        const { applyGrpcState } = await loadGrpcHandler();

        applyGrpcState({ target: 'fresh:50051', requestJson: '{}', metadata: {} });

        expect(document.getElementById('grpc-target-input').value).toBe('fresh:50051');
        expect(document.querySelectorAll('input[aria-label="gRPC Target"]')).toHaveLength(1);
    });

    it('tolerates missing state', async () => {
        const { applyGrpcState, captureGrpcState } = await loadGrpcHandler();

        applyGrpcState(undefined);

        expect(captureGrpcState()).toEqual({
            target: '',
            service: '',
            fullMethod: '',
            requestJson: '{}',
            metadata: {},
            useTls: false,
            protoPath: null,
            clientStreaming: false,
            serverStreaming: false
        });
    });
});
