/* global document */
import { CompletionContext, startCompletion, currentCompletions, completionStatus } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { RequestBodyEditor } from '../../src/modules/requestBodyEditor.js';
import { JSONEditor } from '../../src/modules/jsonEditor.js';
import { variableCompletionSource, refreshVariablesEffect } from '../../src/modules/editors/variableExtension.js';
import { VARIABLES_CHANGED_EVENT } from '../../src/modules/variables/VariableContext.js';
import { app } from '../../src/modules/appContext.js';

const ENTRIES = [
    { status: 'resolved', name: 'baseUrl', scope: 'environment', value: 'https://dev', secret: false, envName: 'Dev' },
    { status: 'resolved', name: 'token', scope: 'environment', value: null, secret: true, envName: 'Dev' },
    { status: 'dynamic', name: '$uuid', scope: 'dynamic', value: null, secret: false, envName: null, description: 'UUID v4' }
];

function stubContext(table = ENTRIES) {
    return {
        list: () => table,
        lookup: (name) => table.find((entry) => entry.name === name) ?? { status: 'unresolved', name, scope: null, value: null, secret: false, envName: null }
    };
}

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return host;
}

function pills(editor) {
    return [...editor.view.contentDOM.querySelectorAll('.var-token')].map((el) => [el.textContent, el.className, el.dataset.var]);
}

describe('variable decorations in editors', () => {
    afterEach(() => {
        delete app.variableContext;
        document.body.innerHTML = '';
    });

    test.each([
        ['RequestBodyEditor json', () => new RequestBodyEditor(mount())],
        ['RequestBodyEditor plain', () => new RequestBodyEditor(mount(), { language: 'plain' })],
        ['JSONEditor', () => new JSONEditor(mount())]
    ])('%s marks tokens with their status', (_name, make) => {
        app.variableContext = stubContext();
        const editor = make();

        editor.setContent('{"url": "{{baseUrl}}/x", "t": "{{token}}", "id": "{{$uuid}}", "m": "{{missing}}"}');

        expect(pills(editor)).toEqual([
            ['{{baseUrl}}', 'var-token resolved', 'baseUrl'],
            ['{{token}}', 'var-token resolved', 'token'],
            ['{{$uuid}}', 'var-token dynamic', '$uuid'],
            ['{{missing}}', 'var-token unresolved', 'missing']
        ]);
        editor.destroy();
    });

    test('renders unknown when no context is available', () => {
        const editor = new JSONEditor(mount());
        editor.setContent('{{baseUrl}}');
        expect(pills(editor)).toEqual([['{{baseUrl}}', 'var-token unknown', 'baseUrl']]);
        editor.destroy();
    });

    test('re-classifies on the variables-changed document event and on the refresh effect', () => {
        app.variableContext = stubContext();
        const editor = new JSONEditor(mount());
        editor.setContent('{{baseUrl}}');
        expect(pills(editor)[0][1]).toBe('var-token resolved');

        app.variableContext = stubContext([]);
        document.dispatchEvent(new CustomEvent(VARIABLES_CHANGED_EVENT, { detail: { version: 2 } }));
        expect(pills(editor)[0][1]).toBe('var-token unresolved');

        app.variableContext = stubContext();
        editor.view.dispatch({ effects: refreshVariablesEffect.of(null) });
        expect(pills(editor)[0][1]).toBe('var-token resolved');
        editor.destroy();
    });

    test('destroy removes the document listener', () => {
        app.variableContext = stubContext();
        const added = jest.spyOn(document, 'addEventListener');
        const removed = jest.spyOn(document, 'removeEventListener');
        const editor = new JSONEditor(mount());
        const handler = added.mock.calls.find(([type]) => type === VARIABLES_CHANGED_EVENT)[1];

        editor.destroy();

        expect(removed).toHaveBeenCalledWith(VARIABLES_CHANGED_EVENT, handler);
        added.mockRestore();
        removed.mockRestore();
    });
});

describe('variableCompletionSource', () => {
    function complete(doc, pos, context = stubContext(), explicit = false) {
        const state = EditorState.create({ doc });
        return variableCompletionSource(() => context)(new CompletionContext(state, pos, explicit));
    }

    test('offers matching variables after {{ with scope detail and masked info', () => {
        const result = complete('{"a": "{{ba', 11);

        expect(result.from).toBe(9);
        expect(result.options.map((o) => [o.label, o.detail, o.info, o.type])).toEqual([
            ['baseUrl', 'Environment "Dev"', 'https://dev', 'variable']
        ]);
    });

    test('lists dynamic variables for $ and returns null outside a token', () => {
        expect(complete('{{$', 3).options.map((o) => o.label)).toEqual(['$uuid']);
        expect(complete('{{$', 3).options[0].info).toBe('UUID v4');
        expect(complete('plain', 5)).toBeNull();
        expect(complete('{{done}}', 8)).toBeNull();
        expect(complete('{{zzz', 5)).toBeNull();
        expect(complete('{{', 2, stubContext([]))).toBeNull();
    });

    test('apply inserts the name with closing braces unless they already follow', () => {
        const editor = new JSONEditor(mount());
        editor.setContent('x {{ba tail');
        const result = complete('x {{ba tail', 6);

        result.options[0].apply(editor.view, result.options[0], result.from, 6);
        expect(editor.getContent()).toBe('x {{baseUrl}} tail');
        expect(editor.view.state.selection.main.head).toBe('x {{baseUrl}}'.length);

        editor.setContent('{{tok}}');
        const second = complete('{{tok}}', 5, stubContext());
        second.options[0].apply(editor.view, second.options[0], second.from, 5);
        expect(editor.getContent()).toBe('{{token}}');
        expect(editor.view.state.selection.main.head).toBe(9);
        editor.destroy();
        document.body.innerHTML = '';
    });
});

describe('autocompletion integration', () => {
    afterEach(() => {
        delete app.variableContext;
        document.body.innerHTML = '';
    });

    test.each([
        ['RequestBodyEditor', () => new RequestBodyEditor(mount())],
        ['JSONEditor', () => new JSONEditor(mount())]
    ])('%s resolves variable completions through the editor state', async (_name, make) => {
        app.variableContext = stubContext();
        const editor = make();
        editor.setContent('{"a": "{{ba');
        editor.view.dispatch({ selection: { anchor: editor.getContent().length } });

        startCompletion(editor.view);
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(completionStatus(editor.view.state)).toBe('active');
        expect(currentCompletions(editor.view.state).map((c) => c.label)).toEqual(['baseUrl']);
        editor.destroy();
    });
});
