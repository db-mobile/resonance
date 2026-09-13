/* global document */
// GraphQLEditor is covered separately: cm6-graphql pulls an ESM-only transitive
// dependency that jest cannot transform under this config.
import { JSONEditor } from '../../src/modules/jsonEditor.js';
import { ScriptEditor } from '../../src/modules/scriptEditor.js';
import { SchemaEditor } from '../../src/modules/schemaEditor.js';
import { RequestBodyEditor } from '../../src/modules/requestBodyEditor.js';
import { ResponseEditor } from '../../src/modules/responseEditor.js';

/** @returns {HTMLElement} */
function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return host;
}

describe('shared editor lifecycle', () => {
    const cases = [
        ['JSONEditor', () => new JSONEditor(mount())],
        ['ScriptEditor', () => new ScriptEditor(mount())],
        ['RequestBodyEditor', () => new RequestBodyEditor(mount())]
    ];

    test.each(cases)('%s round-trips content', (_name, make) => {
        const editor = make();
        editor.setContent('hello');
        expect(editor.getContent()).toBe('hello');
        editor.destroy();
    });

    test.each(cases)('%s coerces null content to an empty string', (_name, make) => {
        const editor = make();
        editor.setContent(null);
        expect(editor.getContent()).toBe('');
        editor.destroy();
    });

    test.each(cases)('%s notifies onChange when the document changes', (_name, make) => {
        const editor = make();
        const cb = jest.fn();
        editor.onChange(cb);
        editor.setContent('abc');
        expect(cb).toHaveBeenCalledWith('abc');
        editor.destroy();
    });

    test.each(cases)('%s suppresses onChange when emitChange is false', (_name, make) => {
        const editor = make();
        const cb = jest.fn();
        editor.onChange(cb);
        editor.setContent('abc', { emitChange: false });
        expect(cb).not.toHaveBeenCalled();
        expect(editor.getContent()).toBe('abc');
        editor.destroy();
    });

    test.each(cases)('%s clears', (_name, make) => {
        const editor = make();
        editor.setContent('abc');
        editor.clear();
        expect(editor.getContent()).toBe('');
        editor.destroy();
    });

    test.each(cases)('%s destroy tears the view down and is safe twice', (_name, make) => {
        const editor = make();
        editor.destroy();
        expect(editor.view).toBeNull();
        expect(() => editor.destroy()).not.toThrow();
        expect(editor.getContent()).toBe('');
        editor.destroy();
    });

    test.each(cases)('%s renders line-number gutters', (_name, make) => {
        const editor = make();
        expect(editor.container.querySelector('.cm-gutters')).not.toBeNull();
        editor.destroy();
    });
});

describe('RequestBodyEditor', () => {
    test('formatJSON pretty-prints valid JSON', () => {
        const editor = new RequestBodyEditor(mount());
        editor.setContent('{"a":1,"b":[1,2]}');
        expect(editor.formatJSON()).toBe(true);
        expect(editor.getContent()).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
        editor.destroy();
    });

    test('formatJSON reports failure on invalid JSON and leaves content alone', () => {
        const editor = new RequestBodyEditor(mount());
        editor.setContent('{nope');
        expect(editor.formatJSON()).toBe(false);
        expect(editor.getContent()).toBe('{nope');
        editor.destroy();
    });

    test('formatJSON is a no-op in plain mode', () => {
        const editor = new RequestBodyEditor(mount(), { language: 'plain' });
        editor.setContent('{nope');
        expect(editor.formatJSON()).toBe(true);
        expect(editor.getContent()).toBe('{nope');
        editor.destroy();
    });

    test('empty content formats as success', () => {
        const editor = new RequestBodyEditor(mount());
        expect(editor.formatJSON()).toBe(true);
        editor.destroy();
    });
});

describe('SchemaEditor', () => {
    test('setSchema stringifies and getSchema parses back', () => {
        const editor = new SchemaEditor(mount());
        editor.setSchema({ type: 'object' });
        expect(editor.getContent()).toBe('{\n  "type": "object"\n}');
        expect(editor.getSchema()).toEqual({ type: 'object' });
        editor.destroy();
    });

    test('setSchema(null) empties the editor and getSchema returns null', () => {
        const editor = new SchemaEditor(mount());
        editor.setSchema({ type: 'object' });
        editor.setSchema(null);
        expect(editor.getContent()).toBe('');
        expect(editor.getSchema()).toBeNull();
        editor.destroy();
    });

    test('isValidJson treats empty as valid and garbage as invalid', () => {
        const editor = new SchemaEditor(mount());
        expect(editor.isValidJson()).toBe(true);
        editor.setContent('{nope');
        expect(editor.isValidJson()).toBe(false);
        editor.destroy();
    });

    test('the onChange option is debounced, not fired synchronously', () => {
        jest.useFakeTimers();
        const onChange = jest.fn();
        const editor = new SchemaEditor(mount(), { onChange });

        editor.setContent('{"a":1}');
        expect(onChange).not.toHaveBeenCalled();

        jest.advanceTimersByTime(500);
        expect(onChange).toHaveBeenCalledWith('{"a":1}');

        editor.destroy();
        jest.useRealTimers();
    });

    test('emitChange false suppresses the debounced callback', () => {
        jest.useFakeTimers();
        const onChange = jest.fn();
        const editor = new SchemaEditor(mount(), { onChange });

        editor.setContent('{"a":1}', { emitChange: false });
        jest.advanceTimersByTime(500);
        expect(onChange).not.toHaveBeenCalled();

        editor.destroy();
        jest.useRealTimers();
    });

    test('setting identical content short-circuits without re-notifying', () => {
        jest.useFakeTimers();
        const onChange = jest.fn();
        const editor = new SchemaEditor(mount(), { onChange });

        editor.setContent('{"a":1}');
        jest.advanceTimersByTime(500);
        onChange.mockClear();

        editor.setContent('{"a":1}');
        jest.advanceTimersByTime(500);
        expect(onChange).not.toHaveBeenCalled();

        editor.destroy();
        jest.useRealTimers();
    });

    test('destroy cancels a pending debounced callback', () => {
        jest.useFakeTimers();
        const onChange = jest.fn();
        const editor = new SchemaEditor(mount(), { onChange });

        editor.setContent('{"a":1}');
        editor.destroy();
        jest.advanceTimersByTime(500);

        expect(onChange).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});

describe('ResponseEditor', () => {
    test('detects the language from the content type', () => {
        const editor = new ResponseEditor(mount());
        expect(editor.detectLanguageFromContentType('application/json; charset=utf-8').type).toBe('json');
        expect(editor.detectLanguageFromContentType('text/xml').type).toBe('xml');
        expect(editor.detectLanguageFromContentType('text/html').type).toBe('html');
        expect(editor.detectLanguageFromContentType('text/plain').type).toBe('text');
        expect(editor.detectLanguageFromContentType('application/octet-stream')).toBeNull();
        editor.destroy();
    });

    test('sniffs the language from the body when no content type is given', () => {
        const editor = new ResponseEditor(mount());
        expect(editor.detectLanguage('{"a":1}').type).toBe('json');
        expect(editor.detectLanguage('<?xml version="1.0"?><a/>').type).toBe('xml');
        expect(editor.detectLanguage('<!DOCTYPE html><html></html>').type).toBe('html');
        expect(editor.detectLanguage('plain words')).toBeNull();
        editor.destroy();
    });

    test('setContent reports the resolved language through onLanguageChange', () => {
        const editor = new ResponseEditor(mount());
        const seen = [];
        editor.onLanguageChange(lang => seen.push(lang));

        editor.setContent('{"a":1}', 'application/json');
        expect(editor.getContent()).toBe('{"a":1}');
        expect(seen).toEqual(['json']);
        editor.destroy();
    });

    test('a manual override wins over the content type', () => {
        const editor = new ResponseEditor(mount());
        editor.setLanguage('xml');
        editor.setContent('{"a":1}', 'application/json');
        expect(editor.currentLanguage).toBe('xml');
        editor.destroy();
    });

    test('an explicit language hint wins over sniffing', () => {
        const editor = new ResponseEditor(mount());
        editor.setContent('{"a":1}', null, 'text');
        expect(editor.currentLanguage).toBe('text');
        editor.destroy();
    });

    test('is read-only', () => {
        const editor = new ResponseEditor(mount());
        expect(editor.view.state.readOnly).toBe(true);
        editor.destroy();
    });
});
