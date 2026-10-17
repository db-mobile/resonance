/* global document, window */
import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function untilCalled(mock, count = 1) {
    for (let attempt = 0; attempt < 30 && mock.mock.calls.length < count; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(count);
}

const validResult = { valid: true, schemaValid: true, errors: [] };
const invalidResult = {
    valid: false,
    schemaValid: true,
    errors: [{ path: '/id', keyword: 'type', message: 'Expected integer' }]
};

async function loadApiHandler() {
    document.body.innerHTML = `${requestBarMarkup()}${requestFormMarkup()}<div class="status-info-container"></div>`;
    jest.resetModules();
    jest.doMock('../../src/modules/editorLoader.js', () => {
        const stub = () => new Proxy({}, {
            get: (target, prop) => {
                if (prop === 'then') { return undefined; }
                if (!(prop in target)) { target[prop] = jest.fn(); }
                return target[prop];
            }
        });
        class FakeEditor {
            constructor() { return stub(); }
        }
        return {
            loadEditor: jest.fn(() => Promise.resolve(FakeEditor)),
            warmEditors: jest.fn(),
            createLazyEditorProxy: jest.fn(() => stub())
        };
    });

    const { handleSendRequest } = await import('../../src/modules/apiHandler.js');
    const { app } = await import('../../src/modules/appContext.js');
    const { AuthManager } = await import('../../src/modules/authManager.js');
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');
    const { SchemaController } = await import('../../src/modules/controllers/SchemaController.js');
    app.authManager = new AuthManager({ typeSelect: null, fieldsContainer: null });
    initTabListeners();

    const response = {
        success: true,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { id: 42 }
    };
    window.backendAPI = {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({}) },
        history: { add: jest.fn().mockResolvedValue(undefined) },
        sendApiRequest: jest.fn().mockResolvedValue(response),
        schema: {
            check: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
            validate: jest.fn().mockResolvedValue(validResult)
        }
    };
    const { installTestRequestPipeline } = await import('../helpers/requestPipeline.js');
    await installTestRequestPipeline(app, window.backendAPI);

    const updateTab = jest.fn().mockResolvedValue(undefined);
    app.workspaceTabController = {
        service: { getActiveTabId: jest.fn().mockResolvedValue('tab-1'), updateTab }
    };
    app.cookieController = {
        handleCookiesFromResponse: jest.fn(),
        getCookieHeader: jest.fn().mockResolvedValue(null)
    };

    const container = {
        tabId: 'tab-1',
        statusContainer: document.querySelector('.status-info-container'),
        editor: { setContent: jest.fn() },
        headersEditor: { setContent: jest.fn() }
    };
    const containers = new Map([['tab-1', container]]);
    app.responseContainerManager = {
        containers,
        getOrCreateContainer: jest.fn(tabId => containers.get(tabId))
    };

    let schemaText = '{"type":"object","properties":{"id":{"type":"integer"}}}';
    const repository = {
        getResponseSchema: jest.fn().mockResolvedValue(JSON.parse(schemaText)),
        saveResponseSchema: jest.fn().mockResolvedValue(undefined)
    };
    const controller = new SchemaController({
        repository,
        statusDisplay: { update: jest.fn() },
        backendAPI: window.backendAPI
    });
    controller.editor = {
        __ready: Promise.resolve(),
        getContent: () => schemaText,
        getSchema: () => JSON.parse(schemaText),
        setSchema: (schema) => { schemaText = schema == null ? '' : JSON.stringify(schema); },
        destroy: jest.fn()
    };
    controller._initialized = true;
    controller.currentCollectionId = 'collection-A';
    controller.currentEndpointId = 'endpoint-A';
    app.schemaController = controller;

    setCurrentEndpoint(null);
    document.getElementById('url-input').value = 'https://api.example.com/items';
    return {
        handleSendRequest, app, controller, response, updateTab, container, containers,
        backendAPI: window.backendAPI,
        editSchema: (schema) => { schemaText = JSON.stringify(schema); }
    };
}

let loaded;

afterEach(() => {
    loaded?.controller.destroy();
    document.body.innerHTML = '';
    delete window.backendAPI;
    loaded = undefined;
});

describe('HTTP response schema validation', () => {
    test('awaits native validation before rendering the successful schema badge', async () => {
        loaded = await loadApiHandler();
        const pending = deferred();
        loaded.backendAPI.schema.validate.mockReturnValueOnce(pending.promise);
        let finished = false;
        const sending = loaded.handleSendRequest().then(() => { finished = true; });
        await untilCalled(loaded.backendAPI.schema.validate);

        expect(finished).toBe(false);
        expect(document.querySelector('.response-validation-badge')).toBeNull();
        pending.resolve(validResult);
        await sending;

        const badge = document.querySelector('.response-validation-badge');
        expect(badge.textContent).toBe('Schema Valid');
        expect(badge.classList.contains('is-success')).toBe(true);
        expect(loaded.updateTab).toHaveBeenCalledWith('tab-1', expect.objectContaining({
            response: expect.objectContaining({ status: 200, data: { id: 42 } })
        }));
    });

    test('validates with the schema captured before the request even after an edit', async () => {
        loaded = await loadApiHandler();
        const captured = loaded.controller.captureSchema().schema;
        const response = deferred();
        loaded.backendAPI.sendApiRequest.mockReturnValueOnce(response.promise);
        const sending = loaded.handleSendRequest();
        await untilCalled(loaded.backendAPI.sendApiRequest);
        loaded.editSchema({ const: 'new schema' });

        response.resolve(loaded.response);
        await sending;

        expect(loaded.backendAPI.schema.validate).toHaveBeenCalledWith(captured, { id: 42 });
        expect(document.querySelector('.response-validation-badge')).toBeNull();
    });

    test('does not overwrite a newer same-tab request badge with an older validation result', async () => {
        loaded = await loadApiHandler();
        const firstValidation = deferred();
        loaded.backendAPI.schema.validate.mockReturnValueOnce(firstValidation.promise);
        const firstSend = loaded.handleSendRequest();
        await untilCalled(loaded.backendAPI.schema.validate);

        await loaded.handleSendRequest();
        expect(document.querySelector('.response-validation-badge').textContent).toBe('Schema Valid');
        firstValidation.resolve(invalidResult);
        await firstSend;

        expect(document.querySelector('.response-validation-badge').textContent).toBe('Schema Valid');
        expect(document.querySelectorAll('.response-validation-badge')).toHaveLength(1);
    });

    test('keeps the newer response status, headers, and persisted tab response when older validation finishes last', async () => {
        loaded = await loadApiHandler();
        const firstValidation = deferred();
        const olderResponse = {
            ...loaded.response,
            status: 201,
            statusText: 'Created',
            headers: { 'content-type': 'application/json', 'x-response': 'older' },
            data: { id: 1 }
        };
        const newerResponse = {
            ...loaded.response,
            status: 202,
            statusText: 'Accepted',
            headers: { 'content-type': 'application/json', 'x-response': 'newer' },
            data: { id: 2 }
        };
        loaded.backendAPI.sendApiRequest
            .mockResolvedValueOnce(olderResponse)
            .mockResolvedValueOnce(newerResponse);
        loaded.backendAPI.schema.validate.mockReturnValueOnce(firstValidation.promise);
        const firstSend = loaded.handleSendRequest();
        await untilCalled(loaded.backendAPI.schema.validate);

        await loaded.handleSendRequest();
        firstValidation.resolve(invalidResult);
        await firstSend;

        expect(loaded.updateTab).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({
            response: expect.objectContaining({ status: 202, data: { id: 2 }, headers: newerResponse.headers })
        }));
        expect(document.getElementById('status-display').textContent).toContain('202');
        expect(loaded.container.headersEditor.setContent).toHaveBeenLastCalledWith(
            JSON.stringify(newerResponse.headers, null, 2), 'application/json'
        );
        expect(loaded.container.editor.setContent).toHaveBeenLastCalledWith(
            JSON.stringify(newerResponse.data, null, 2), 'application/json', 'json'
        );
    });

    test.each(['closed tab', 'replaced container', 'schema edit', 'context switch'])(
        'discards validation feedback after a %s', async (change) => {
            loaded = await loadApiHandler();
            const pending = deferred();
            loaded.backendAPI.schema.validate.mockReturnValueOnce(pending.promise);
            const sending = loaded.handleSendRequest();
            await untilCalled(loaded.backendAPI.schema.validate);

            if (change === 'closed tab') {
                loaded.containers.delete('tab-1');
                loaded.container.statusContainer.remove();
            } else if (change === 'replaced container') {
                const replacement = { ...loaded.container, statusContainer: document.createElement('div') };
                document.body.appendChild(replacement.statusContainer);
                loaded.containers.set('tab-1', replacement);
            } else if (change === 'schema edit') {
                loaded.editSchema({ type: 'array' });
            } else {
                // The next endpoint deliberately has identical schema content.
                // A content-only stale-result guard would miss this switch.
                await loaded.controller.loadSchema('collection-B', 'endpoint-B');
            }

            pending.resolve(invalidResult);
            await sending;

            expect(document.querySelector('.response-validation-badge')).toBeNull();
            expect(loaded.container.statusContainer.querySelector('.response-validation-badge')).toBeNull();
        }
    );

    test('a native validation failure preserves the HTTP response and reports unavailable validation', async () => {
        loaded = await loadApiHandler();
        loaded.backendAPI.schema.validate.mockRejectedValueOnce(new Error('Native validator unavailable'));

        await loaded.handleSendRequest();

        expect(document.getElementById('status-display').textContent).toContain('200');
        expect(document.getElementById('status-display').textContent).not.toContain('Request Failed');
        const badge = document.querySelector('.response-validation-badge');
        expect(badge.textContent).toBe('Schema validation unavailable');
        expect(badge.classList.contains('is-error')).toBe(true);
        expect(loaded.updateTab).toHaveBeenCalledWith('tab-1', expect.objectContaining({
            response: expect.objectContaining({ status: 200, data: { id: 42 } })
        }));
        expect(loaded.container.editor.setContent).toHaveBeenLastCalledWith(
            JSON.stringify({ id: 42 }, null, 2), 'application/json', 'json'
        );
    });

    test('malformed JSON fails validation without treating the response as a valid schema string', async () => {
        loaded = await loadApiHandler();
        loaded.editSchema({ type: 'string' });
        loaded.backendAPI.sendApiRequest.mockResolvedValueOnce({
            ...loaded.response,
            data: '{broken',
            isJson: false
        });

        await loaded.handleSendRequest();

        expect(loaded.backendAPI.schema.validate).not.toHaveBeenCalled();
        const badge = document.querySelector('.response-validation-badge');
        expect(badge.textContent).toBe('Schema Invalid (1)');
        expect(badge.classList.contains('is-error')).toBe(true);
        expect(badge.title).toContain('Response is not valid JSON');
        expect(document.getElementById('status-display').textContent).toContain('200');
    });

    test('validates an already-decoded JSON scalar string without parsing it as a number', async () => {
        loaded = await loadApiHandler();
        loaded.editSchema({ type: 'string' });
        loaded.backendAPI.sendApiRequest.mockResolvedValueOnce({
            ...loaded.response,
            data: '123',
            isJson: true
        });

        await loaded.handleSendRequest();

        expect(loaded.backendAPI.schema.validate).toHaveBeenCalledWith({ type: 'string' }, '123');
        expect(document.querySelector('.response-validation-badge').textContent).toBe('Schema Valid');
    });

    test('an older error response delayed in scripts does not clear the newer badge or inference response', async () => {
        loaded = await loadApiHandler();
        const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');
        setCurrentEndpoint({ collectionId: 'collection-A', endpointId: 'endpoint-A' });
        const firstScript = deferred();
        loaded.app.scriptController = {
            executePreRequest: jest.fn((_collection, _endpoint, request) => Promise.resolve(request)),
            executeTest: jest.fn().mockReturnValueOnce(firstScript.promise).mockResolvedValue(undefined)
        };
        loaded.backendAPI.sendApiRequest
            .mockResolvedValueOnce({ ...loaded.response, status: 500, data: { error: 'older' } })
            .mockResolvedValueOnce({ ...loaded.response, data: { id: 99 } });
        const olderSend = loaded.handleSendRequest();
        await untilCalled(loaded.app.scriptController.executeTest);

        await loaded.handleSendRequest();
        expect(document.querySelector('.response-validation-badge').textContent).toBe('Schema Valid');
        expect(loaded.controller.lastResponseBody).toEqual({ id: 99 });

        firstScript.resolve(undefined);
        await olderSend;

        expect(document.querySelector('.response-validation-badge').textContent).toBe('Schema Valid');
        expect(loaded.controller.lastResponseBody).toEqual({ id: 99 });
        expect(loaded.backendAPI.schema.validate).toHaveBeenCalledTimes(1);
        expect(loaded.backendAPI.schema.validate).toHaveBeenCalledWith(expect.any(Object), { id: 99 });
    });
});
