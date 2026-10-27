import { installExecutionMock } from '../helpers/coreExecution.js';
/* global document, window */
import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

const VARIABLES = {};

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
    const { AuthManager } = await import('../../src/modules/authManager.js');
    const authManager = new AuthManager({ typeSelect: null, fieldsContainer: null });
    app.authManager = authManager;
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

    installExecutionMock(window.backendAPI);
    const { installTestRequestPipeline } = await import('../helpers/requestPipeline.js');
    await installTestRequestPipeline(app, window.backendAPI);

    const toastError = jest.spyOn(toast, 'error').mockImplementation(() => {});
    const setRequestRunning = jest.fn();
    app.statusBar = { setRequestRunning };

    setCurrentEndpoint(null);
    document.getElementById('url-input').value = 'https://api.example.com/items';
    document.getElementById('method-select').value = 'POST';
    document.getElementById('headers-list').innerHTML = headerRowMarkup('X-Trace', 't1');

    return { ...apiHandler, app, toastError, responseEditor, setRequestRunning, setRequestMode };
}


afterEach(() => { document.body.innerHTML = ''; delete window.backendAPI; });

// Body preparation assertions now live in resonance-core's baseline and preparation tests.
// This boundary verifies every unsaved editor input reaches that executor intact.
test.each(['GET', 'DELETE', 'POST'].flatMap(method => ['json', 'text', 'formdata', 'urlencoded', 'binary'].map(mode => [method, mode])))('captures unsaved %s %s inputs without frontend substitution', async (method, mode) => {
    const loaded = await loadApiHandler();
    document.getElementById('method-select').value = method;
    document.getElementById('body-mode-select').value = mode;
    loaded.app.requestBodyEditor = { getContent: () => '{"token":"{{token}}"}' };
    loaded.app.requestBodyTextEditor = { getContent: () => '{{token}} raw text' };
    loaded.app.formBodyManager = {
        getFormDataRows: () => [{ key: 'file', type: 'file', filePath: '/{{token}}.bin', enabled: true }],
        getUrlencodedRows: () => [{ key: 'key', value: '{{token}}', enabled: false }],
        getBinaryBody: () => ({ filePath: '/{{token}}.bin', contentType: 'image/png' })
    };
    await loaded.handleSendRequest();
    const input = window.backendAPI.execution.request.mock.calls[0][0];
    expect(input.request.method).toBe(method);
    expect(input.request.body.mode).toBe(mode);
    expect(input.request.headers).toEqual({ 'X-Trace': 't1' });
    if (mode === 'json') { expect(input.request.body.content).toBe('{"token":"{{token}}"}'); }
    if (mode === 'text') { expect(input.request.body.content).toBe('{{token}} raw text'); }
    if (mode === 'binary') { expect(input.request.body.filePath).toBe('/{{token}}.bin'); }
    if (mode === 'formdata') { expect(input.request.body.fields[0].filePath).toBe('/{{token}}.bin'); }
    if (mode === 'urlencoded') { expect(input.request.body.fields[0].value).toBe('{{token}}'); }
});

test('captures unsaved GraphQL query, variables and selected operation', async () => {
    const loaded = await loadApiHandler();
    loaded.setRequestMode('graphql');
    loaded.setGraphQLBodyManager({ getGraphQLQuery: () => 'query {{operation}} { id }',
        getGraphQLVariables: () => '{"id":"{{token}}"}', getSelectedOperationName: () => 'Get', isGraphQLMode: () => true });
    await loaded.handleSendRequest();
    expect(window.backendAPI.execution.request.mock.calls[0][0].request.body.graphql).toEqual({
        query: 'query {{operation}} { id }', variables: '{"id":"{{token}}"}', operationName: 'Get'
    });
    loaded.setGraphQLBodyManager(null);
});

test.each(['GET', 'DELETE'].flatMap(method => ['json', 'text'].map(mode => [method, mode])))('captures %s %s body for code snippets', async (method, mode) => {
    const loaded = await loadApiHandler();
    const { CodeSnippetDialog } = await import('../../src/modules/ui/CodeSnippetDialog.js');
    const show = jest.spyOn(CodeSnippetDialog.prototype, 'show').mockImplementation(() => {});
    document.getElementById('method-select').value = method;
    document.getElementById('body-mode-select').value = mode;
    loaded.app.requestBodyEditor = { getContent: () => '{"id":7}' };
    loaded.app.requestBodyTextEditor = { getContent: () => ' Grüße 7\n' };
    try {
        await loaded.handleGenerateCurl();
        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            method, body: mode === 'json' ? { id: 7 } : ' Grüße 7\n'
        }));
    } finally {
        show.mockRestore();
    }
});

test('body capture errors are delivered to the shared executor for classification', async () => {
    const loaded = await loadApiHandler();
    document.getElementById('body-mode-select').value = 'formdata';
    loaded.app.formBodyManager = { getFormDataRows: () => { throw new Error('reader failed'); } };
    await loaded.handleSendRequest();
    expect(window.backendAPI.execution.request.mock.calls[0][0].request.body.captureError).toContain('reader failed');
});
