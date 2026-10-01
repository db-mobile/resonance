import { formatJsonBody } from '../../src/modules/utils/formatJson.js';

describe('formatJsonBody', () => {
    test('matches JSON.stringify for plain JSON', () => {
        const input = '{"a":1,"b":[true,null,"x"],"c":{"d":{"e":-1.5}}}';

        expect(formatJsonBody(input)).toEqual({
            ok: true,
            text: JSON.stringify(JSON.parse(input), null, 2)
        });
    });

    test('keeps empty containers on one line', () => {
        expect(formatJsonBody('{"a":{},"b":[ ]}').text).toBe('{\n  "a": {},\n  "b": []\n}');
    });

    test('leaves string contents untouched', () => {
        const input = '{"s":"a, {b}: [c] \\" {{d}}"}';

        expect(formatJsonBody(input).text).toBe('{\n  "s": "a, {b}: [c] \\" {{d}}"\n}');
    });

    test('preserves unquoted placeholders', () => {
        const result = formatJsonBody('{"id":{{userId}},"tags":[{{tag}},2]}');

        expect(result).toEqual({
            ok: true,
            text: '{\n  "id": {{userId}},\n  "tags": [\n    {{tag}},\n    2\n  ]\n}'
        });
    });

    test('preserves quoted placeholders', () => {
        expect(formatJsonBody('{"name":"{{name}}"}').text).toBe('{\n  "name": "{{name}}"\n}');
    });

    test('preserves number spelling beyond double precision', () => {
        expect(formatJsonBody('{"n":12345678901234567890,"f":1.0}').text)
            .toBe('{\n  "n": 12345678901234567890,\n  "f": 1.0\n}');
    });

    test('preserves duplicate keys', () => {
        expect(formatJsonBody('{"a":1,"a":2}').text).toBe('{\n  "a": 1,\n  "a": 2\n}');
    });

    test('rejects invalid JSON', () => {
        const result = formatJsonBody('{"a":1,}');

        expect(result.ok).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
    });

    test('reports error positions against the original text', () => {
        const result = formatJsonBody('{"s":"{{v}}","n":{{v}},}');

        expect(result.ok).toBe(false);
        expect(result.error.message).toContain('23');
    });

    test('rejects an unterminated placeholder', () => {
        expect(formatJsonBody('{"a":{{x}').ok).toBe(false);
    });

    test('leaves whitespace-only input alone', () => {
        expect(formatJsonBody('  \n')).toEqual({ ok: true, text: '  \n' });
    });

    test('is idempotent', () => {
        const once = formatJsonBody('[{"a":[1,{"b":{{v}}}]}]').text;

        expect(formatJsonBody(once).text).toBe(once);
    });
});
