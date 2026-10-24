/* global document */
import { GraphQLBodyManager } from '../../src/modules/graphqlBodyManager.js';
import { app } from '../../src/modules/appContext.js';
import { setRequestMode } from '../../src/modules/requestModeManager.js';
import { requestBarMarkup } from '../helpers/requestBarMarkup.js';

describe('WebSocket text and JSON composer', () => {
    let manager;
    let select;
    let format;
    let json;
    let text;
    const change = mode => {
        select.value = mode;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    beforeEach(() => {
        document.body.innerHTML = requestBarMarkup();
        format = document.createElement('button');
        format.id = 'body-format-btn';
        document.getElementById('body').appendChild(format);
        json = '{ "a": 1 }\n';
        text = 'stale text';
        app.requestBodyEditor = { getContent: () => json, setContent: value => { json = value; }, formatJSONWithFeedback: jest.fn() };
        app.requestBodyTextEditor = { getContent: () => text, setContent: value => { text = value; }, ensure: jest.fn() };
        manager = new GraphQLBodyManager({});
        app.graphqlBodyManager = manager;
        manager.initialize();
        select = document.getElementById('body-mode-select');
        setRequestMode('websocket');
    });
    afterEach(() => {
        delete app.requestBodyEditor;
        delete app.requestBodyTextEditor;
        delete app.graphqlBodyManager;
        document.body.innerHTML = '';
    });

    test('offers only JSON and Text with an enabled mode selector', () => {
        expect(Array.from(select.options, option => option.value)).toEqual(['json', 'text']);
        expect(select.disabled).toBe(false);
        expect(select.closest('.body-mode-selector-container').style.display).not.toBe('none');
    });

    test('Format is visible only in JSON mode and formatting requires an explicit click', () => {
        expect(format.hidden).toBe(false);
        change('text');
        expect(format.hidden).toBe(true);
        change('json');
        expect(format.hidden).toBe(false);
        expect(app.requestBodyEditor.formatJSONWithFeedback).not.toHaveBeenCalled();
        format.click();
        expect(app.requestBodyEditor.formatJSONWithFeedback).toHaveBeenCalledTimes(1);
    });

    test('switching modes keeps the message exactly, including whitespace and invalid JSON', () => {
        const original = json;
        change('text');
        expect(text).toBe(original);
        text = '  arbitrary text\n\n';
        change('json');
        expect(json).toBe('  arbitrary text\n\n');
        change('text');
        expect(text).toBe('  arbitrary text\n\n');
    });

    test('reapplying WebSocket mode preserves the selected Text mode', () => {
        change('text');
        setRequestMode('websocket');
        expect(select.value).toBe('text');
        expect(manager.currentMode).toBe('text');
        expect(format.hidden).toBe(true);
    });

    test('switching between HTTP and WebSocket does not suppress JSON formatting', () => {
        change('text');
        setRequestMode('http');
        change('json');
        expect(format.hidden).toBe(false);
        setRequestMode('websocket');
        expect(format.hidden).toBe(false);
    });
});
