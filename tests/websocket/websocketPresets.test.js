/* global document */
import { WebSocketPresetList } from '../../src/modules/websocket/websocketPresets.js';

const MARKUP = `
    <button id="websocket-save-message-btn">Save current message</button>
    <div id="websocket-messages-list" hidden></div>
    <p id="websocket-messages-empty">No saved messages yet.</p>
`;

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function build(overrides = {}) {
    const deps = {
        promptName: jest.fn(async (name) => name),
        loadMessage: jest.fn(),
        sendMessage: jest.fn(async () => {}),
        readComposer: jest.fn(() => ({ mode: 'json', content: '{"type":"ping"}' })),
        notifyChanged: jest.fn(),
        warn: jest.fn(),
        ...overrides
    };
    const list = new WebSocketPresetList(deps);
    list.initialize();
    return { list, deps };
}

const rows = () => [...document.querySelectorAll('#websocket-messages-list .row')];
const click = (action, id) => document.querySelector(`[data-action="${action}"][data-id="${id}"]`).click();

describe('WebSocketPresetList', () => {
    beforeEach(() => { document.body.innerHTML = MARKUP; });
    afterEach(() => { document.body.innerHTML = ''; });

    test('starts empty with the hint visible and the list hidden', () => {
        build();

        expect(document.getElementById('websocket-messages-empty').hidden).toBe(false);
        expect(document.getElementById('websocket-messages-list').hidden).toBe(true);
    });

    test('setMessages renders one row per preset with name, first line and mode, without notifying', () => {
        const { list, deps } = build();

        list.setMessages([
            { id: 'a', name: 'Ping', mode: 'json', content: '\n{"type":"ping"}\nsecond' },
            { id: 'b', name: 'Hello', mode: 'text', content: 'hello' }
        ]);

        expect(rows().map((row) => row.querySelector('.title').textContent)).toEqual(['Ping', 'Hello']);
        expect(rows()[0].querySelector('.subtitle').textContent).toBe('{"type":"ping"}');
        expect(rows().map((row) => row.querySelector('.websocket-message-mode').textContent)).toEqual(['json', 'text']);
        expect(document.getElementById('websocket-messages-empty').hidden).toBe(true);
        expect(document.getElementById('websocket-messages-list').hidden).toBe(false);
        expect(deps.notifyChanged).not.toHaveBeenCalled();
    });

    test('getMessages returns copies so callers cannot mutate the list', () => {
        const { list } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'json', content: 'x' }]);

        const copy = list.getMessages();
        copy[0].name = 'changed';
        copy.push({ id: 'z' });

        expect(list.getMessages()).toEqual([{ id: 'a', name: 'Ping', mode: 'json', content: 'x' }]);
    });

    test('Save current prompts with a numbered default name and appends the composer snapshot', async () => {
        const { list, deps } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'json', content: 'x' }]);
        deps.promptName.mockResolvedValueOnce('  Subscribe ');

        document.getElementById('websocket-save-message-btn').click();
        await flush();

        expect(deps.promptName).toHaveBeenCalledWith('Message 2');
        const saved = list.getMessages()[1];
        expect(saved).toMatchObject({ name: 'Subscribe', mode: 'json', content: '{"type":"ping"}' });
        expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(rows()).toHaveLength(2);
        expect(deps.notifyChanged).toHaveBeenCalledTimes(1);
    });

    test('a cancelled prompt leaves the list untouched', async () => {
        const { list, deps } = build({ promptName: jest.fn(async () => null) });

        await list.saveCurrent();

        expect(list.getMessages()).toEqual([]);
        expect(deps.notifyChanged).not.toHaveBeenCalled();
    });

    test('an empty composer warns instead of prompting', async () => {
        const { list, deps } = build({ readComposer: () => ({ mode: 'text', content: '  \n' }) });

        await list.saveCurrent();

        expect(deps.warn).toHaveBeenCalledTimes(1);
        expect(deps.promptName).not.toHaveBeenCalled();
        expect(list.getMessages()).toEqual([]);
    });

    test('Load hands a copy of the preset to the composer without changing the list', () => {
        const { list, deps } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'text', content: 'ping' }]);

        click('load', 'a');

        expect(deps.loadMessage).toHaveBeenCalledWith({ id: 'a', name: 'Ping', mode: 'text', content: 'ping' });
        expect(deps.sendMessage).not.toHaveBeenCalled();
        expect(deps.notifyChanged).not.toHaveBeenCalled();
    });

    test('Send transmits only the preset content and never touches the composer', () => {
        const { list, deps } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'json', content: '{"type":"ping"}' }]);

        click('send', 'a');

        expect(deps.sendMessage).toHaveBeenCalledWith('{"type":"ping"}');
        expect(deps.loadMessage).not.toHaveBeenCalled();
        expect(deps.readComposer).not.toHaveBeenCalled();
    });

    test('Delete removes the row and notifies', () => {
        const { list, deps } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'json', content: 'x' }, { id: 'b', name: 'Pong', mode: 'json', content: 'y' }]);

        click('delete', 'a');

        expect(list.getMessages().map((message) => message.id)).toEqual(['b']);
        expect(rows()).toHaveLength(1);
        expect(deps.notifyChanged).toHaveBeenCalledTimes(1);
        expect(document.getElementById('websocket-messages-empty').hidden).toBe(true);
    });

    test('deleting the last preset shows the hint again', () => {
        const { list } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'json', content: 'x' }]);

        click('delete', 'a');

        expect(document.getElementById('websocket-messages-empty').hidden).toBe(false);
        expect(document.getElementById('websocket-messages-list').hidden).toBe(true);
    });

    test('clicks outside an action button are ignored', () => {
        const { list, deps } = build();
        list.setMessages([{ id: 'a', name: 'Ping', mode: 'json', content: 'x' }]);

        document.querySelector('#websocket-messages-list .title').click();

        expect(deps.loadMessage).not.toHaveBeenCalled();
        expect(deps.sendMessage).not.toHaveBeenCalled();
        expect(list.getMessages()).toHaveLength(1);
    });
});
