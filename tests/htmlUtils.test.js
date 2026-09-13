import { escapeHtml, el } from '../src/modules/htmlUtils.js';

describe('escapeHtml', () => {
    test('should escape HTML special characters', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
        expect(escapeHtml("it's")).toBe('it&#039;s');
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('should handle null and undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    test('should coerce non-string values', () => {
        expect(escapeHtml(0)).toBe('0');
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(false)).toBe('false');
    });
});

describe('el', () => {
    test('creates a bare element when only a tag is given', () => {
        const node = el('div');
        expect(node.tagName).toBe('DIV');
        expect(node.className).toBe('');
        expect(node.textContent).toBe('');
    });

    test('applies a class name', () => {
        expect(el('span', 'a b').className).toBe('a b');
    });

    test('applies text content', () => {
        expect(el('span', 'x', 'hello').textContent).toBe('hello');
    });

    test('sets an empty string as text, but skips null and undefined', () => {
        expect(el('span', 'x', '').textContent).toBe('');
        expect(el('span', 'x', null).textContent).toBe('');
        expect(el('span', 'x', undefined).textContent).toBe('');
    });

    test('sets numeric text content', () => {
        expect(el('span', null, 0).textContent).toBe('0');
    });

    test('skips a falsy class name', () => {
        expect(el('span', '', 'hi').className).toBe('');
    });
});
