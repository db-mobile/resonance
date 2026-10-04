/* global document, window */
import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

const VARIABLES = { host: 'example.com', token: 's3cret' };

function headerRowMarkup(key, value) {
    return `<div class="key-value-row">
        <input class="key-input" value="${key}">
        <input class="value-input" value="${value}">
    </div>`;
}

async function loadApiHandler() {
    document.body.innerHTML = requestBarMarkup() + requestFormMarkup();
    jest.resetModules();

    const responseEditor = { setContent: jest.fn(), clear: jest.fn(), onLanguageChange: jest.fn(), setLanguage: jest.fn() };
    jest.doMock('../../src/modules/editorLoader.js', () => ({
        loadEditor: jest.fn(() => Promise.resolve(class {})),
        warmEditors: jest.fn(),
        createLazyEditorProxy: jest.fn(() => responseEditor)
    }));
    jest.doMock('../../src/modules/collectionManager.js', () => ({
        saveAllRequestModifications: jest.fn().mockResolvedValue(undefined),
        saveRequestToCollection: jest.fn(),
        getCollections: jest.fn().mockResolvedValue([])
    }));
    jest.doMock('../../src/modules/services/RequestBuilderService.js', () => {
        const { VariableProcessor } = jest.requireActual('../../src/modules/variables/VariableProcessor.js');
        return {
            RequestBuilderService: class {
                async resolveVariables() {
                    return { variables: VARIABLES, processor: new VariableProcessor() };
                }
                mergeAuthData() {}
                processRequestComponents({ url }) {
                    return { url, queryString: '', pathParams: {} };
                }
            }
        };
    });

    const apiHandler = await import('../../src/modules/apiHandler.js');
    const { app } = await import('../../src/modules/appContext.js');
    const { toast } = await import('../../src/modules/ui/Toast.js');
    const { initTabListeners } = await import('../../src/modules/tabManager.js');
    const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');
    const { setRequestMode } = await import('../../src/modules/requestModeManager.js');

    initTabListeners();

    window.backendAPI = {
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) },
        settings: { get: jest.fn().mockResolvedValue({}) },
        history: { add: jest.fn().mockResolvedValue(undefined) },
        sendApiRequest: jest.fn().mockResolvedValue({ success: true, status: 200, headers: {}, data: 'ok' })
    };

    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => {});
    const setRequestRunning = jest.fn();
    app.statusBar = { setRequestRunning };

    setCurrentEndpoint(null);
    document.getElementById('url-input').value = 'https://api.example.com/items';
    document.getElementById('method-select').value = 'POST';
    document.getElementById('headers-list').innerHTML = headerRowMarkup('X-Trace', 't1');

    return { ...apiHandler, app, toastError, responseEditor, setRequestRunning, setRequestMode };
}

function selectBodyMode(mode) {
    document.getElementById('body-mode-select').value = mode;
}

function sentConfig() {
    return window.backendAPI.sendApiRequest.mock.calls[0][0];
}

function lastCallIndex(fn, predicate = () => true) {
    const calls = fn.mock.calls
        .map((args, index) => ({ args, order: fn.mock.invocationCallOrder[index] }))
        .filter(({ args }) => predicate(args));
    return calls.length ? calls[calls.length - 1].order : -1;
}

function expectAbortedSend({ toastError, responseEditor, setRequestRunning }, message) {
    expect(window.backendAPI.sendApiRequest).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toBe(message);
    expect(responseEditor.clear).toHaveBeenCalledTimes(1);
    const toastOrder = toastError.mock.invocationCallOrder[0];
    const clearOrder = responseEditor.clear.mock.invocationCallOrder[0];
    const stopOrder = lastCallIndex(setRequestRunning, ([running]) => running === false);
    expect(toastOrder).toBeLessThan(clearOrder);
    expect(clearOrder).toBeLessThan(stopOrder);
    expect(document.getElementById('cancel-request-btn').style.display).toBe('none');
    expect(document.getElementById('send-request-btn').disabled).toBe(false);
}

let loaded;

afterEach(() => {
    loaded?.toastError.mockRestore();
    delete loaded?.app.formBodyManager;
    delete loaded?.app.requestBodyTextEditor;
    delete loaded?.app.statusBar;
    loaded?.setGraphQLBodyManager(null);
    loaded = null;
    document.body.innerHTML = '';
    delete window.backendAPI;
});

describe('form-data body mode', () => {
    test('sends the enabled rows templated, tagged with bodyType formdata, and keeps the request headers', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('formdata');
        loaded.app.formBodyManager = {
            getFormDataRows: () => [
                { key: 'user', value: '{{token}}', type: 'text', enabled: true },
                { key: 'skip', value: 'x', type: 'text', enabled: false },
                { key: 'upload', value: '', type: 'file', filePath: '/tmp/{{host}}.bin', contentType: 'application/octet-stream' }
            ]
        };

        await loaded.handleSendRequest();

        const sent = sentConfig();
        expect(sent.bodyType).toBe('formdata');
        expect(sent.body).toEqual([
            { key: 'user', value: 's3cret', type: 'text', filePath: undefined, contentType: undefined },
            { key: 'upload', value: '', type: 'file', filePath: '/tmp/example.com.bin', contentType: 'application/octet-stream' }
        ]);
        expect(sent.headers).toEqual({ 'X-Trace': 't1' });
    });

    test('keeps bodyType formdata even when every row is disabled and no body is sent', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('formdata');
        loaded.app.formBodyManager = {
            getFormDataRows: () => [{ key: 'skip', value: 'x', type: 'text', enabled: false }]
        };

        await loaded.handleSendRequest();

        expect(sentConfig().body).toBeUndefined();
        expect(sentConfig().bodyType).toBe('formdata');
    });

    test('is sent with GET because form bodies do not depend on the method', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('formdata');
        document.getElementById('method-select').value = 'GET';
        loaded.app.formBodyManager = {
            getFormDataRows: () => [{ key: 'a', value: '1', type: 'text', enabled: true }]
        };

        await loaded.handleSendRequest();

        expect(sentConfig().method).toBe('GET');
        expect(sentConfig().body).toEqual([{ key: 'a', value: '1', type: 'text', filePath: undefined, contentType: undefined }]);
        expect(sentConfig().bodyType).toBe('formdata');
    });

    test('a throwing row reader aborts with the body-processing toast', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('formdata');
        loaded.app.formBodyManager = {
            getFormDataRows: () => {
                throw new Error('rows unavailable');
            }
        };

        await loaded.handleSendRequest();

        expectAbortedSend(loaded, 'Error processing request body: rows unavailable');
    });
});

describe('urlencoded body mode', () => {
    test('sends the urlencoded rows templated and tagged with bodyType urlencoded', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('urlencoded');
        loaded.app.formBodyManager = {
            getUrlencodedRows: () => [{ key: 'q', value: '{{host}}', type: 'text', enabled: true }]
        };

        await loaded.handleSendRequest();

        expect(sentConfig().bodyType).toBe('urlencoded');
        expect(sentConfig().body).toEqual([{ key: 'q', value: 'example.com', type: 'text', filePath: undefined, contentType: undefined }]);
    });
});

describe('binary body mode', () => {
    test('sends the templated file path and content type tagged with bodyType binary', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('binary');
        loaded.app.formBodyManager = {
            getBinaryBody: () => ({ filePath: '/data/{{host}}.pdf', contentType: 'application/pdf' })
        };

        await loaded.handleSendRequest();

        expect(sentConfig().body).toEqual({ filePath: '/data/example.com.pdf', contentType: 'application/pdf' });
        expect(sentConfig().bodyType).toBe('binary');
    });

    test('an empty content type is sent as undefined', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('binary');
        loaded.app.formBodyManager = {
            getBinaryBody: () => ({ filePath: '/data/file.bin', contentType: '' })
        };

        await loaded.handleSendRequest();

        expect(sentConfig().body).toEqual({ filePath: '/data/file.bin', contentType: undefined });
    });

    test('a missing file toasts, clears the response, ends the in-progress state in that order and never sends', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('binary');
        loaded.app.formBodyManager = {
            getBinaryBody: () => ({ filePath: '', contentType: '' })
        };

        await loaded.handleSendRequest();

        expectAbortedSend(loaded, 'No file selected for binary body.');
    });
});

describe('text body mode', () => {
    test('sends the templated raw text tagged with bodyType text', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('text');
        loaded.app.requestBodyTextEditor = { getContent: () => 'host is {{host}}' };

        await loaded.handleSendRequest();

        expect(sentConfig().body).toBe('host is example.com');
        expect(sentConfig().bodyType).toBe('text');
    });

    test('keeps bodyType text when the editor is empty and no body is sent', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('text');
        loaded.app.requestBodyTextEditor = { getContent: () => '' };

        await loaded.handleSendRequest();

        expect(sentConfig().body).toBeUndefined();
        expect(sentConfig().bodyType).toBe('text');
    });
});

describe('JSON body mode', () => {
    function setJsonBody(text) {
        document.querySelector('.body-mode-panel[data-mode="json"]').innerHTML =
            `<textarea id="body-input">${text}</textarea>`;
    }

    test('sends the parsed, templated object without a bodyType', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('json');
        setJsonBody('{"token": "{{token}}", "n": 1}');

        await loaded.handleSendRequest();

        expect(sentConfig().body).toEqual({ token: 's3cret', n: 1 });
        expect(sentConfig().bodyType).toBeUndefined();
    });

    test('a blank editor sends no body and no bodyType', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('json');
        setJsonBody('   ');

        await loaded.handleSendRequest();

        expect(sentConfig().body).toBeUndefined();
        expect(sentConfig().bodyType).toBeUndefined();
    });

    test('GET drops the JSON body because the method carries none', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('json');
        document.getElementById('method-select').value = 'GET';
        setJsonBody('{"ignored": true}');

        await loaded.handleSendRequest();

        expect(sentConfig().body).toBeUndefined();
        expect(sentConfig().bodyType).toBeUndefined();
    });

    test('unparseable JSON aborts with the Invalid Body JSON toast', async () => {
        loaded = await loadApiHandler();
        selectBodyMode('json');
        setJsonBody('{ not json');

        await loaded.handleSendRequest();

        expect(window.backendAPI.sendApiRequest).not.toHaveBeenCalled();
        expect(loaded.toastError.mock.calls[0][0]).toMatch(/^Invalid Body JSON: /);
        expectAbortedSend(loaded, loaded.toastError.mock.calls[0][0]);
    });
});

describe('GraphQL body', () => {
    function graphqlManager({ query, variables, operationName }) {
        return {
            getGraphQLQuery: () => query,
            getGraphQLVariables: () => variables,
            getSelectedOperationName: () => operationName,
            isGraphQLMode: () => true
        };
    }

    test('sends query, parsed variables and the selected operation name as a POST without a bodyType', async () => {
        loaded = await loadApiHandler();
        loaded.setRequestMode('graphql');
        document.getElementById('method-select').value = 'GET';
        loaded.setGraphQLBodyManager(graphqlManager({
            query: ' query Q($h: String) { host(h: $h) { name } } ',
            variables: '{"h": "{{host}}"}',
            operationName: 'Q'
        }));

        await loaded.handleSendRequest();

        const sent = sentConfig();
        expect(sent.method).toBe('POST');
        expect(sent.body).toEqual({
            query: 'query Q($h: String) { host(h: $h) { name } }',
            variables: { h: 'example.com' },
            operationName: 'Q'
        });
        expect(sent.bodyType).toBeUndefined();
    });

    test('omits operationName when none is selected and defaults variables to an empty object', async () => {
        loaded = await loadApiHandler();
        loaded.setRequestMode('graphql');
        loaded.setGraphQLBodyManager(graphqlManager({ query: '{ me { id } }', variables: '', operationName: null }));

        await loaded.handleSendRequest();

        expect(sentConfig().body).toEqual({ query: '{ me { id } }', variables: {} });
        expect(sentConfig().body).not.toHaveProperty('operationName');
    });

    test('unparseable variables JSON aborts with the Invalid GraphQL Variables JSON toast', async () => {
        loaded = await loadApiHandler();
        loaded.setRequestMode('graphql');
        loaded.setGraphQLBodyManager(graphqlManager({ query: '{ me { id } }', variables: '{ nope', operationName: null }));

        await loaded.handleSendRequest();

        expect(loaded.toastError.mock.calls[0][0]).toMatch(/^Invalid GraphQL Variables JSON: /);
        expectAbortedSend(loaded, loaded.toastError.mock.calls[0][0]);
    });
});
