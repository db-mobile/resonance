/* global document, window */
import {
    decorateInput,
    decorateInputsIn,
    getDecoratedInputs,
    getDecoration,
    isDecorated,
    lookupVariable,
    refreshAll,
    refreshInput,
    setUrlVariableLookup,
    setVariableLookup
} from '../../src/modules/ui/inputDecorator.js';

const LOOKUP = {
    base: { status: 'resolved', name: 'base', scope: 'environment', value: 'https://dev', secret: false, envName: 'Dev' },
    key: { status: 'resolved', name: 'key', scope: 'collection', value: null, secret: true, envName: null }
};

function stubLookup(table = LOOKUP) {
    setVariableLookup((name) => table[name] ?? { status: 'unresolved', name, scope: null, value: null, secret: false, envName: null });
}

function makeInput({ type = 'text', value = '', className = 'value-input', parent = document.body } = {}) {
    const input = document.createElement('input');
    if (type) {
        input.type = type;
    }
    input.className = className;
    input.value = value;
    parent.appendChild(input);
    return input;
}

function pills(input) {
    return [...getDecoration(input).text.querySelectorAll('.var-token')].map((el) => [el.textContent, el.className, el.dataset.var]);
}

describe('decorateInput', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        stubLookup();
        setUrlVariableLookup(() => null);
    });

    test('wraps the input in a var-field with a mirror and keeps the input first', () => {
        const input = makeInput({ value: 'x' });

        const wrapper = decorateInput(input);

        expect(wrapper.className).toBe('var-field var-field--value-input');
        expect(wrapper.parentElement).toBe(document.body);
        expect(wrapper.children[0]).toBe(input);
        expect(wrapper.children[1].className).toBe('var-field-mirror');
        expect(wrapper.children[1].getAttribute('aria-hidden')).toBe('true');
        expect(wrapper.querySelector('.var-field-mirror-text').textContent).toBe('x');
        expect(input.spellcheck).toBe(false);
        expect(isDecorated(input)).toBe(true);
    });

    test('is idempotent and upgrades the url flag', () => {
        const input = makeInput();
        const first = decorateInput(input);

        expect(decorateInput(input, { url: true })).toBe(first);
        expect(document.querySelectorAll('.var-field')).toHaveLength(1);
        expect(getDecoration(input).url).toBe(true);
    });

    test('leaves password, number and non-input elements alone', () => {
        const password = makeInput({ type: 'password' });
        const number = makeInput({ type: 'number' });
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);

        expect(decorateInput(password)).toBeNull();
        expect(decorateInput(number)).toBeNull();
        expect(decorateInput(textarea)).toBeNull();
        expect(decorateInput(null)).toBeNull();
        expect(document.querySelector('.var-field')).toBeNull();
    });

    test('decorates url and search inputs and inputs without an explicit type', () => {
        const url = makeInput({ type: 'url' });
        const search = makeInput({ type: 'search' });
        const untyped = makeInput({ type: null });

        expect(decorateInput(url)).not.toBeNull();
        expect(decorateInput(search)).not.toBeNull();
        expect(decorateInput(untyped)).not.toBeNull();
    });

    test('paints tokens with status classes and keeps surrounding text', () => {
        const input = makeInput({ value: 'https://{{base}}/v1?k={{key}}&x={{nope}}&id={{$uuid}}' });
        setVariableLookup((name) => name === '$uuid'
            ? { status: 'dynamic', name }
            : (LOOKUP[name] ?? { status: 'unresolved', name }));

        decorateInput(input);

        expect(pills(input)).toEqual([
            ['{{base}}', 'var-token resolved', 'base'],
            ['{{key}}', 'var-token resolved', 'key'],
            ['{{nope}}', 'var-token unresolved', 'nope'],
            ['{{$uuid}}', 'var-token dynamic', '$uuid']
        ]);
        expect(getDecoration(input).text.textContent).toBe(input.value);
    });

    test('renders attacker-controlled values as text, never markup', () => {
        const payload = '<img src=x onerror="window.__pwned=1">{{base}}<b>';
        const input = makeInput({ value: payload });

        decorateInput(input);

        const { text } = getDecoration(input);
        expect(text.querySelector('img')).toBeNull();
        expect(text.querySelector('b')).toBeNull();
        expect(text.textContent).toBe(payload);
        expect(window.__pwned).toBeUndefined();
    });

    test('re-renders on input events', () => {
        const input = makeInput({ value: '' });
        decorateInput(input);
        expect(pills(input)).toEqual([]);

        input.value = '{{base}}';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        expect(pills(input)).toEqual([['{{base}}', 'var-token resolved', 'base']]);
    });

    test('unknown lookups render as unknown and a missing lookup function falls back', () => {
        setVariableLookup(null);
        const input = makeInput({ value: '{{base}}' });

        decorateInput(input);

        expect(pills(input)).toEqual([['{{base}}', 'var-token unknown', 'base']]);
    });

    test('url inputs treat path parameters as resolved via the url lookup', () => {
        setUrlVariableLookup(() => ({ id: '42' }));
        const url = makeInput({ type: 'url', value: '{{base}}/users/{{id}}/{{$uuid}}' });
        const plain = makeInput({ value: '{{id}}' });

        decorateInput(url, { url: true });
        decorateInput(plain);

        expect(pills(url).map((p) => p[1])).toEqual(['var-token resolved', 'var-token path-param', 'var-token unresolved']);
        expect(pills(plain)).toEqual([['{{id}}', 'var-token unresolved', 'id']]);
        expect(lookupVariable('id', url)).toMatchObject({ status: 'path-param', scope: 'path-param', value: '42' });
        expect(lookupVariable('id', plain).status).toBe('unresolved');
        expect(lookupVariable('base').status).toBe('resolved');
    });
});

describe('refresh', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        stubLookup();
        setUrlVariableLookup(() => null);
    });

    test('refreshAll reclassifies every token after the lookup changes and prunes detached inputs', () => {
        const kept = makeInput({ value: '{{base}}' });
        const gone = makeInput({ value: '{{base}}' });
        decorateInput(kept);
        decorateInput(gone);
        getDecoration(gone).wrapper.remove();

        stubLookup({});
        refreshAll();

        expect(pills(kept)).toEqual([['{{base}}', 'var-token unresolved', 'base']]);
        expect(isDecorated(gone)).toBe(false);
        expect(getDecoratedInputs()).toContain(kept);
    });

    test('refreshAll picks up values written programmatically', () => {
        const input = makeInput({ value: '' });
        decorateInput(input);

        input.value = 'a={{base}}';
        refreshAll();

        expect(pills(input)).toHaveLength(1);
        input.value = 'plain';
        refreshAll();
        expect(pills(input)).toHaveLength(0);
        expect(getDecoration(input).text.textContent).toBe('plain');
    });

    test('refreshAll and focus repaint a programmatically cleared value so no stale text lingers', () => {
        const input = makeInput({ value: 'https://old.example' });
        decorateInput(input);
        expect(getDecoration(input).text.textContent).toBe('https://old.example');

        input.value = '';
        refreshAll();
        expect(getDecoration(input).text.textContent).toBe('');

        input.value = 'typed later';
        input.dispatchEvent(new window.FocusEvent('focus'));
        expect(getDecoration(input).text.textContent).toBe('typed later');
    });

    test('refreshInput re-renders one input and ignores undecorated ones', () => {
        const input = makeInput({ value: '{{base}}' });
        decorateInput(input);
        stubLookup({});

        refreshInput(input);
        refreshInput(document.createElement('input'));

        expect(pills(input)).toEqual([['{{base}}', 'var-token unresolved', 'base']]);
    });
});

describe('decorateInputsIn', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        stubLookup();
    });

    test('decorates only the key-value family inside a row and marks the key wrapper', () => {
        const row = document.createElement('div');
        row.className = 'key-value-row';
        row.innerHTML = `
            <input type="checkbox" class="row-enabled-checkbox">
            <input type="text" class="key-input" value="{{base}}">
            <input type="text" class="value-input">
            <input type="text" class="other-input">
            <button class="remove-row-btn"></button>`;
        document.body.appendChild(row);

        const wrappers = decorateInputsIn(row);

        expect(wrappers).toHaveLength(2);
        expect(row.querySelector('.var-field--key-input > .key-input')).not.toBeNull();
        expect(row.querySelector('.var-field > .value-input')).not.toBeNull();
        expect(row.querySelector('.other-input').parentElement).toBe(row);
        expect(row.querySelector('.row-enabled-checkbox').parentElement).toBe(row);
        expect(decorateInputsIn(null)).toEqual([]);
    });
});
