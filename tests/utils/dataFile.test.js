import { parseCsv, parseJsonRows, parseDataFile } from '../../src/modules/utils/dataFile.js';

describe('parseCsv', () => {
    test('maps each row to the header columns', () => {
        expect(parseCsv('email,role\nada@x.io,admin\nbob@x.io,user\n')).toEqual([
            { email: 'ada@x.io', role: 'admin' },
            { email: 'bob@x.io', role: 'user' }
        ]);
    });

    test('handles quotes, escaped quotes, commas and newlines inside a field', () => {
        const rows = parseCsv('name,note\n"Doe, Jane","said ""hi""\nthen left"\n');

        expect(rows).toEqual([{ name: 'Doe, Jane', note: 'said "hi"\nthen left' }]);
    });

    test('accepts CRLF, a BOM and a missing trailing newline, and skips blank lines', () => {
        expect(parseCsv('\uFEFFa,b\r\n1,2\r\n\r\n3,4')).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
    });

    test('fills missing trailing values with empty strings', () => {
        expect(parseCsv('a,b,c\n1\n')).toEqual([{ a: '1', b: '', c: '' }]);
    });

    test('reports the line of a row with too many values', () => {
        expect(() => parseCsv('a,b\n1,2\n1,2,3\n')).toThrow('Line 3: more values than columns');
    });

    test('reports an unclosed quote', () => {
        expect(() => parseCsv('a\n"open\n')).toThrow('Line 2: a quoted value is never closed');
    });

    test('rejects a header with an empty column name', () => {
        expect(() => parseCsv('a,,c\n1,2,3\n')).toThrow('every column needs a name');
    });

    test('a header-only file has no rows', () => {
        expect(parseCsv('a,b\n')).toEqual([]);
    });
});

describe('parseJsonRows', () => {
    test('turns every value into a string, JSON-encoding nested ones', () => {
        expect(parseJsonRows('[{"id": 1, "ok": true, "tags": ["a"], "none": null}]')).toEqual([
            { id: '1', ok: 'true', tags: '["a"]', none: '' }
        ]);
    });

    test('rejects anything but an array of objects', () => {
        expect(() => parseJsonRows('{"a": 1}')).toThrow('array of objects');
        expect(() => parseJsonRows('[1, 2]')).toThrow('array of objects');
    });

    test('reports invalid JSON', () => {
        expect(() => parseJsonRows('[{')).toThrow('Invalid JSON');
    });
});

describe('parseDataFile', () => {
    test('picks the parser from the file extension', () => {
        expect(parseDataFile('users.JSON', '[{"a": "1"}]')).toEqual([{ a: '1' }]);
        expect(parseDataFile('users.csv', 'a\n1\n')).toEqual([{ a: '1' }]);
    });
});
