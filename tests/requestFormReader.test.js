/* global document */
import { RequestFormReader } from '../src/modules/requestFormReader.js';
import { getProtocol } from '../src/modules/protocols/protocolRegistry.js';
import { app } from '../src/modules/appContext.js';

function row(key, value, enabled) {
    const checkbox = enabled === undefined ? '' : `<input type="checkbox" class="row-enabled-checkbox" ${enabled ? 'checked' : ''}>`;
    return `<div class="key-value-row"><input class="key-input" value="${key}"><input class="value-input" value="${value}">${checkbox}</div>`;
}

function fullForm() {
    document.body.innerHTML = `
        <input id="url-input" value="https://api.test/x">
        <input id="sse-url-input" value="https://sse.test/events">
        <select id="method-select"><option value="GET">GET</option><option value="POST" selected>POST</option></select>
        <div id="path-params-list">${row('id', '7')}${row('off', '1', false)}</div>
        <div id="query-params-list">${row('q', 'x', false)}</div>
        <div id="headers-list">${row('Accept', '*/*', true)}</div>
        <select id="body-mode-select"><option value="json" selected>json</option></select>
        <textarea id="body-input">{"a":1}</textarea>
    `;
}

afterEach(() => {
    document.body.innerHTML = '';
    delete app.formBodyManager;
    delete app.requestBodyEditor;
});

describe('RequestFormReader.read', () => {
    test('captures every field as plain data', () => {
        fullForm();
        const reader = new RequestFormReader({ authManager: { getAuthConfig: () => ({ type: 'bearer', config: { token: 't' } }) } });

        expect(reader.read()).toEqual({
            url: 'https://api.test/x',
            method: 'POST',
            pathParams: { id: '7' },
            queryParams: [{ key: 'q', value: 'x', enabled: false }],
            headers: [{ key: 'Accept', value: '*/*', enabled: true }],
            bodyState: { modifiedBody: '{"a":1}', formBodyData: null, graphqlData: null },
            authConfig: { type: 'bearer', config: { token: 't' } }
        });
    });

    test('reads a protocol\'s own URL field when the descriptor names one', () => {
        fullForm();

        expect(new RequestFormReader().read(getProtocol('sse')).url).toBe('https://sse.test/events');
        expect(new RequestFormReader().read(getProtocol('http')).url).toBe('https://api.test/x');
    });

    test('reports absent fields as null so callers can tell missing from empty', () => {
        document.body.innerHTML = '<input id="url-input" value="">';

        expect(new RequestFormReader().read()).toEqual({
            url: '', method: null, pathParams: null, queryParams: null, headers: null, bodyState: null, authConfig: null
        });
        expect(new RequestFormReader().hasBody()).toBe(false);
    });
});

describe('RequestFormReader body state', () => {
    test('prefers a form body, then a GraphQL body, then the raw editor content', () => {
        fullForm();
        const graphql = { isGraphQLMode: () => true, getGraphQLQuery: () => 'query', getGraphQLVariables: () => '{}', getSelectedOperationName: () => 'Op' };
        const reader = new RequestFormReader({ graphqlBodyManager: graphql });

        expect(reader.readBodyState()).toEqual({ modifiedBody: null, formBodyData: null, graphqlData: { mode: 'graphql', query: 'query', variables: '{}' } });
        expect(reader.readGraphQLData()).toEqual({ query: 'query', variables: '{}', operationName: 'Op' });

        document.getElementById('body-mode-select').innerHTML = '<option value="formdata" selected>formdata</option>';
        app.formBodyManager = { getFormDataRows: () => [{ key: 'f', value: 'v' }] };
        expect(reader.readBodyState().formBodyData).toEqual({ mode: 'formdata', fields: [{ key: 'f', value: 'v' }] });
        expect(reader.readTabBody()).toEqual({ mode: 'formdata', fields: [{ key: 'f', value: 'v' }] });
    });

    test('an empty editor stores a null body and a raw tab body', () => {
        fullForm();
        document.getElementById('body-input').value = '   ';

        const reader = new RequestFormReader();

        expect(reader.readBodyState()).toEqual({ modifiedBody: null, formBodyData: null, graphqlData: null });
        expect(reader.readTabBody()).toEqual({ mode: 'json', content: '   ' });
        expect(reader.readGraphQLData()).toBeNull();
        expect(reader.readGrpcState()).toEqual({});
    });
});

describe('RequestFormReader.clear', () => {
    test('blanks the url, method, body and the three row lists', () => {
        fullForm();

        new RequestFormReader().clear();

        expect(document.getElementById('url-input').value).toBe('');
        expect(document.getElementById('method-select').value).toBe('GET');
        expect(document.getElementById('body-input').value).toBe('');
        for (const id of ['path-params-list', 'query-params-list', 'headers-list']) {
            expect(document.getElementById(id).children).toHaveLength(0);
        }
    });

    test('tolerates a page without the form', () => {
        document.body.innerHTML = '';

        expect(() => new RequestFormReader().clear()).not.toThrow();
    });
});
