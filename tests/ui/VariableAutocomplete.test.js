/* global document, window */
import { VariableAutocomplete, matchTrigger, filterEntries } from '../../src/modules/ui/VariableAutocomplete.js';
import { decorateInput } from '../../src/modules/ui/inputDecorator.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const ENTRIES = [
    { status: 'resolved', name: 'baseUrl', scope: 'environment', value: 'https://dev', secret: false, envName: 'Dev' },
    { status: 'resolved', name: 'token', scope: 'environment', value: null, secret: true, envName: 'Dev' },
    { status: 'resolved', name: 'apiBase', scope: 'collection', value: 'v2', secret: false, envName: null },
    { status: 'resolved', name: 'baseUrl', scope: 'collection', value: 'shadowed', secret: false, envName: null, shadowed: true },
    { status: 'dynamic', name: '$uuid', scope: 'dynamic', value: null, secret: false, envName: null, description: 'UUID v4' }
];

function setup() {
    document.body.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    decorateInput(input);
    const context = { list: jest.fn(() => ENTRIES) };
    const ac = new VariableAutocomplete(() => context);
    ac.install();
    return { input, ac, context };
}

function typeValue(input, value, caret = value.length) {
    input.focus();
    input.value = value;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function key(input, name) {
    const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    return event;
}

function items() {
    return [...document.querySelectorAll('.variable-autocomplete-item')].map((li) => ({
        name: li.querySelector('.variable-autocomplete-name').textContent,
        scope: li.querySelector('.variable-autocomplete-scope').textContent,
        value: li.querySelector('.variable-autocomplete-value').textContent,
        active: li.classList.contains('active')
    }));
}

describe('matchTrigger / filterEntries', () => {
    test('matches an open token before the caret only', () => {
        expect(matchTrigger('https://{{', 10)).toEqual({ start: 8, query: '' });
        expect(matchTrigger('{{ ba', 5)).toEqual({ start: 0, query: 'ba' });
        expect(matchTrigger('{{$uu', 5)).toEqual({ start: 0, query: '$uu' });
        expect(matchTrigger('{{done}}', 8)).toBeNull();
        expect(matchTrigger('{{ba}} tail', 4)).toEqual({ start: 0, query: 'ba' });
        expect(matchTrigger('plain', 5)).toBeNull();
    });

    test('filters case-insensitively, drops shadowed entries, ranks prefix matches first', () => {
        expect(filterEntries(ENTRIES, 'base').map((e) => [e.name, e.scope])).toEqual([
            ['baseUrl', 'environment'], ['apiBase', 'collection']
        ]);
        expect(filterEntries(ENTRIES, '$').map((e) => e.name)).toEqual(['$uuid']);
        expect(filterEntries(ENTRIES, 'zzz')).toEqual([]);
        expect(filterEntries(ENTRIES, '', 2)).toHaveLength(2);
    });
});

describe('VariableAutocomplete', () => {
    let fixture;

    beforeEach(() => {
        jest.useFakeTimers();
        fixture = setup();
    });

    afterEach(() => {
        fixture.ac.destroy();
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    test('opens on {{ for decorated inputs with scope badges and masked values', () => {
        const { input, ac } = fixture;

        typeValue(input, 'x={{');

        expect(ac.isOpen()).toBe(true);
        expect(input.dataset.varCompleting).toBe('true');
        expect(items()).toEqual([
            { name: 'baseUrl', scope: 'Environment "Dev"', value: 'https://dev', active: true },
            { name: 'token', scope: 'Environment "Dev"', value: '••••••', active: false },
            { name: 'apiBase', scope: 'Collection', value: 'v2', active: false },
            { name: '$uuid', scope: 'Dynamic', value: 'UUID v4', active: false }
        ]);
    });

    test('ignores undecorated inputs and closes when the token is finished or empty', () => {
        const { input, ac } = fixture;
        const other = document.createElement('input');
        document.body.appendChild(other);

        typeValue(other, '{{');
        expect(ac.isOpen()).toBe(false);

        typeValue(input, '{{ba');
        expect(items().map((i) => i.name)).toEqual(['baseUrl', 'apiBase']);
        typeValue(input, '{{zzz');
        expect(ac.isOpen()).toBe(false);
        expect(input.dataset.varCompleting).toBeUndefined();
    });

    test('ArrowDown/Enter inserts the token, closes the braces, moves the caret and fires input', () => {
        const { input, ac } = fixture;
        const seen = [];
        input.addEventListener('input', () => seen.push(input.value));
        typeValue(input, 'https://{{ba tail', 12);

        expect(key(input, 'ArrowDown').defaultPrevented).toBe(true);
        expect(items()[1].active).toBe(true);
        const enter = key(input, 'Enter');

        expect(enter.defaultPrevented).toBe(true);
        expect(input.value).toBe('https://{{apiBase}} tail');
        expect(input.selectionStart).toBe('https://{{apiBase}}'.length);
        expect(seen[seen.length - 1]).toBe('https://{{apiBase}} tail');
        expect(ac.isOpen()).toBe(false);
        expect(input.dataset.varCompleting).toBeUndefined();
    });

    test('Tab accepts the active item and does not duplicate existing closing braces', () => {
        const { input } = fixture;
        typeValue(input, '{{tok}}', 5);

        key(input, 'Tab');

        expect(input.value).toBe('{{token}}');
        expect(input.selectionStart).toBe(9);
    });

    test('ArrowUp wraps around and a capture-phase handler stops other listeners while open', () => {
        const { input } = fixture;
        const downstream = jest.fn();
        input.addEventListener('keydown', downstream);
        typeValue(input, '{{');

        key(input, 'ArrowUp');
        expect(items()[3].active).toBe(true);
        key(input, 'Enter');

        expect(downstream).not.toHaveBeenCalled();
        expect(input.value).toBe('{{$uuid}}');
        key(input, 'Enter');
        expect(downstream).toHaveBeenCalledTimes(1);
    });

    test('Escape closes through the shared escape stack and releases it', () => {
        const { input, ac } = fixture;
        typeValue(input, '{{');
        expect(escapeHandlerCount()).toBe(1);

        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(ac.isOpen()).toBe(false);
        expect(escapeHandlerCount()).toBe(0);
        expect(document.querySelector('.variable-autocomplete').classList.contains('visible')).toBe(false);
    });

    test('mousedown on an item selects it and keeps focus on the input', () => {
        const { input } = fixture;
        typeValue(input, '{{');

        const item = document.querySelectorAll('.variable-autocomplete-item')[2];
        const mousedown = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        item.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
        expect(input.value).toBe('{{apiBase}}');
        expect(document.activeElement).toBe(input);
    });

    test('closes shortly after focus leaves the input', () => {
        const { input, ac } = fixture;
        typeValue(input, '{{');

        input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
        expect(ac.isOpen()).toBe(true);
        jest.advanceTimersByTime(150);

        expect(ac.isOpen()).toBe(false);
    });

    test('scrolling inside the list keeps it open, scrolling elsewhere closes it', () => {
        const { input, ac } = fixture;
        typeValue(input, '{{');
        const dropdown = document.querySelector('.variable-autocomplete');

        dropdown.dispatchEvent(new window.Event('scroll', { bubbles: true }));
        expect(ac.isOpen()).toBe(true);

        document.body.dispatchEvent(new window.Event('scroll', { bubbles: true }));
        expect(ac.isOpen()).toBe(false);
    });

    test('mousedown on the list chrome does not steal focus from the input', () => {
        const { input, ac } = fixture;
        typeValue(input, '{{');
        const dropdown = document.querySelector('.variable-autocomplete');

        const mousedown = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        dropdown.dispatchEvent(mousedown);

        expect(mousedown.defaultPrevented).toBe(true);
        expect(ac.isOpen()).toBe(true);
        expect(document.activeElement).toBe(input);
    });

    test('caps the list height to the space below the input and flips above when cramped', () => {
        const { input, ac } = fixture;
        window.innerHeight = 600;
        input.getBoundingClientRect = () => ({ left: 10, top: 100, bottom: 130, width: 300, height: 30 });
        typeValue(input, '{{');
        const dropdown = document.querySelector('.variable-autocomplete');
        expect(dropdown.style.top).toBe('133px');
        expect(dropdown.style.maxHeight).toBe('320px');

        input.getBoundingClientRect = () => ({ left: 10, top: 540, bottom: 570, width: 300, height: 30 });
        ac._position();
        expect(dropdown.style.top).toBe('');
        expect(dropdown.style.bottom).toBe('63px');
        expect(dropdown.style.maxHeight).toBe('320px');

        input.getBoundingClientRect = () => ({ left: 10, top: 380, bottom: 410, width: 300, height: 30 });
        ac._position();
        expect(dropdown.style.top).toBe('413px');
        expect(dropdown.style.maxHeight).toBe('179px');
    });

    test('renders names and values as text', () => {
        const { input, context } = fixture;
        context.list.mockReturnValue([{ status: 'resolved', name: 'x', scope: 'collection', value: '<img src=q onerror="window.__pwned=1">', secret: false, envName: null }]);

        typeValue(input, '{{');

        expect(document.querySelector('.variable-autocomplete img')).toBeNull();
        expect(window.__pwned).toBeUndefined();
    });

    test('open event is dispatched once per session and close resets the marker', () => {
        const { input } = fixture;
        const opens = jest.fn();
        const closes = jest.fn();
        input.addEventListener('variable-autocomplete:open', opens);
        input.addEventListener('variable-autocomplete:close', closes);

        typeValue(input, '{{');
        typeValue(input, '{{b');
        typeValue(input, '{{b}}');

        expect(opens).toHaveBeenCalledTimes(1);
        expect(closes).toHaveBeenCalledTimes(1);
    });
});
