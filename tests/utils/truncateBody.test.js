import { truncateBody } from '../../src/modules/utils/truncateBody.js';

describe('truncateBody', () => {
    test('leaves a string under the limit untouched', () => {
        const result = truncateBody('hello', 100);

        expect(result).toEqual({ value: 'hello', truncated: false, originalSize: 5 });
    });

    test('keeps the original object when it fits', () => {
        const value = { name: 'Ada' };

        const result = truncateBody(value, 100);

        expect(result.value).toBe(value);
        expect(result.truncated).toBe(false);
        expect(result.originalSize).toBe(JSON.stringify(value).length);
    });

    test('slices an oversized string and reports the original size', () => {
        const value = 'x'.repeat(50);

        const result = truncateBody(value, 10);

        expect(result.value).toBe('x'.repeat(10));
        expect(result.truncated).toBe(true);
        expect(result.originalSize).toBe(50);
    });

    test('stringifies an oversized object before slicing', () => {
        const value = { payload: 'y'.repeat(200) };
        const serialized = JSON.stringify(value);

        const result = truncateBody(value, 20);

        expect(result.value).toBe(serialized.substring(0, 20));
        expect(result.truncated).toBe(true);
        expect(result.originalSize).toBe(serialized.length);
    });

    test('passes null and undefined through', () => {
        expect(truncateBody(null, 10)).toEqual({ value: null, truncated: false, originalSize: 0 });
        expect(truncateBody(undefined, 10)).toEqual({
            value: undefined,
            truncated: false,
            originalSize: 0
        });
    });

    test('leaves a value JSON cannot serialize alone', () => {
        const value = () => {};

        const result = truncateBody(value, 1);

        expect(result.value).toBe(value);
        expect(result.truncated).toBe(false);
    });

    test('treats a value exactly at the limit as fitting', () => {
        const result = truncateBody('abcde', 5);

        expect(result.truncated).toBe(false);
        expect(result.value).toBe('abcde');
    });
});
