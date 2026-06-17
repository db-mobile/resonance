import { escapeHtml } from '../src/modules/htmlUtils.js';

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
