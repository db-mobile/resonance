import { normalizeFormRows, isMeaningfulRow } from '../src/modules/utils/formDataRows.js';

describe('normalizeFormRows', () => {
    test('converts legacy flat objects to enabled text rows', () => {
        const rows = normalizeFormRows({ title: 'hello', count: 3 });
        expect(rows).toEqual([
            { key: 'title', value: 'hello', type: 'text', filePath: '', contentType: '', enabled: true },
            { key: 'count', value: '3', type: 'text', filePath: '', contentType: '', enabled: true }
        ]);
    });

    test('passes arrays through preserving order and duplicate keys', () => {
        const rows = normalizeFormRows([
            { key: 'a', value: '1' },
            { key: 'a', value: '2' },
            { key: 'b', value: '3' }
        ]);
        expect(rows.map((r) => `${r.key}=${r.value}`)).toEqual(['a=1', 'a=2', 'b=3']);
    });

    test('defaults type to text and enabled to true', () => {
        const [row] = normalizeFormRows([{ key: 'a', value: '1' }]);
        expect(row.type).toBe('text');
        expect(row.enabled).toBe(true);
    });

    test('keeps file rows with filePath and contentType', () => {
        const [row] = normalizeFormRows([
            { key: 'avatar', type: 'file', filePath: '/tmp/pic.png', contentType: 'image/png', enabled: false }
        ]);
        expect(row).toEqual({
            key: 'avatar',
            value: '',
            type: 'file',
            filePath: '/tmp/pic.png',
            contentType: 'image/png',
            enabled: false
        });
    });

    test('coerces unknown type values to text', () => {
        const [row] = normalizeFormRows([{ key: 'a', type: 'blob' }]);
        expect(row.type).toBe('text');
    });

    test('returns empty array for null, undefined, and non-objects', () => {
        expect(normalizeFormRows(null)).toEqual([]);
        expect(normalizeFormRows(undefined)).toEqual([]);
        expect(normalizeFormRows('nope')).toEqual([]);
    });
});

describe('isMeaningfulRow', () => {
    test('accepts rows with a key, value, or file path', () => {
        expect(isMeaningfulRow({ key: 'a', value: '', filePath: '' })).toBe(true);
        expect(isMeaningfulRow({ key: '', value: 'v', filePath: '' })).toBe(true);
        expect(isMeaningfulRow({ key: '', value: '', filePath: '/tmp/f' })).toBe(true);
    });

    test('rejects empty and whitespace-only rows', () => {
        expect(isMeaningfulRow({ key: '', value: '', filePath: '' })).toBe(false);
        expect(isMeaningfulRow({ key: '  ', value: ' ', filePath: '' })).toBe(false);
        expect(isMeaningfulRow({})).toBe(false);
    });
});
