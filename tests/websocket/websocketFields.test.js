/* global document */
import { app } from '../../src/modules/appContext.js';
import {
    WEBSOCKET_DEFAULTS, formatProtocols, normalizeWebSocketData, parseProtocols, readWebSocketForm, writeWebSocketForm
} from '../../src/modules/websocket/websocketFields.js';

describe('parseProtocols', () => {
    test('splits a comma-separated string, trims, drops empties and keeps order', () => {
        expect(parseProtocols(' chat ,, superchat, ')).toEqual(['chat', 'superchat']);
    });

    test('accepts an array and dedupes case-sensitively keeping the first occurrence', () => {
        expect(parseProtocols(['chat', 'Chat', 'chat', ' superchat'])).toEqual(['chat', 'Chat', 'superchat']);
    });

    test('null and blank mean no protocols', () => {
        expect(parseProtocols(null)).toEqual([]);
        expect(parseProtocols('   ')).toEqual([]);
    });

    test('formatProtocols joins with a comma and space', () => {
        expect(formatProtocols(['chat', 'superchat'])).toBe('chat, superchat');
        expect(formatProtocols([])).toBe('');
    });
});

describe('normalizeWebSocketData', () => {
    test('null data is the defaults with fresh arrays', () => {
        const normalized = normalizeWebSocketData(null);

        expect(normalized).toEqual({ protocols: [], messages: [] });
        expect(Object.isFrozen(normalized.messages)).toBe(false);
        expect(WEBSOCKET_DEFAULTS).toEqual({ protocols: [], messages: [] });
    });

    test('protocols accept a string or an array', () => {
        expect(normalizeWebSocketData({ protocols: 'a, b' }).protocols).toEqual(['a', 'b']);
        expect(normalizeWebSocketData({ protocols: ['a', 'b'] }).protocols).toEqual(['a', 'b']);
    });

    test('messages fall back to json mode, keep whitespace in content and drop unknown keys', () => {
        const [message] = normalizeWebSocketData({
            messages: [{ id: 'm1', name: '  Ping ', mode: 'binary', content: '  {"a":1}\n', extra: true }]
        }).messages;

        expect(message).toEqual({ id: 'm1', name: 'Ping', mode: 'json', content: '  {"a":1}\n' });
    });

    test('text mode is preserved and a blank name becomes Untitled', () => {
        const [message] = normalizeWebSocketData({ messages: [{ id: 'm1', name: ' ', mode: 'text', content: 'hi' }] }).messages;

        expect(message).toMatchObject({ name: 'Untitled', mode: 'text' });
    });

    test('non-object entries are dropped and non-string content is stringified', () => {
        const { messages } = normalizeWebSocketData({ messages: [null, 'x', 7, [], { id: 'm1', content: 42 }] });

        expect(messages).toEqual([{ id: 'm1', name: 'Untitled', mode: 'json', content: '42' }]);
    });

    test('missing and duplicate ids are minted fresh while unique ones survive', () => {
        const { messages } = normalizeWebSocketData({
            messages: [{ id: 'm1', content: 'a' }, { id: 'm1', content: 'b' }, { content: 'c' }, { id: '', content: 'd' }]
        });

        const ids = messages.map((message) => message.id);
        expect(ids[0]).toBe('m1');
        expect(new Set(ids).size).toBe(4);
        ids.slice(1).forEach((id) => expect(id).toMatch(/^[0-9a-f-]{36}$/));
    });

    test('a non-array messages value means no messages', () => {
        expect(normalizeWebSocketData({ messages: 'nope' }).messages).toEqual([]);
        expect(normalizeWebSocketData({ messages: { id: 'x' } }).messages).toEqual([]);
    });
});

describe('WebSocket form read/write', () => {
    let presets;

    beforeEach(() => {
        document.body.innerHTML = '<input id="websocket-protocols-input">';
        presets = { messages: [], getMessages: jest.fn(() => presets.messages), setMessages: jest.fn((messages) => { presets.messages = messages; }) };
        app.websocketPresets = presets;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete app.websocketPresets;
    });

    test('a written record reads back normalised', () => {
        const record = { protocols: ['chat', 'superchat'], messages: [{ id: 'm1', name: 'Ping', mode: 'text', content: 'ping' }] };

        writeWebSocketForm(record);

        expect(document.getElementById('websocket-protocols-input').value).toBe('chat, superchat');
        expect(presets.setMessages).toHaveBeenCalledWith(record.messages);
        expect(readWebSocketForm()).toEqual(record);
    });

    test('reading parses whatever the user typed into the protocols input', () => {
        document.getElementById('websocket-protocols-input').value = ' chat,, superchat ';

        expect(readWebSocketForm().protocols).toEqual(['chat', 'superchat']);
    });

    test('writing a flat tab request only touches the WebSocket fields', () => {
        writeWebSocketForm({ protocol: 'websocket', url: 'wss://x', protocols: 'chat', messages: [] });

        expect(document.getElementById('websocket-protocols-input').value).toBe('chat');
        expect(presets.setMessages).toHaveBeenCalledWith([]);
    });

    test('missing elements and no preset list read as defaults', () => {
        document.body.innerHTML = '';
        delete app.websocketPresets;

        expect(readWebSocketForm()).toEqual({ protocols: [], messages: [] });
        expect(() => writeWebSocketForm({ protocols: ['chat'] })).not.toThrow();
    });
});
