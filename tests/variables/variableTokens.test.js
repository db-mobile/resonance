import { tokenize, maskValue, scopeLabel, SECRET_MASK, TOKEN_PATTERN } from '../../src/modules/variables/variableTokens.js';
import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';

describe('tokenize', () => {
    test('returns an empty list for text without tokens', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize('https://example.com')).toEqual([]);
        expect(tokenize(null)).toEqual([]);
    });

    test('finds static tokens with offsets and raw text', () => {
        expect(tokenize('{{base}}/users/{{ user.id }}')).toEqual([
            { start: 0, end: 8, raw: '{{base}}', name: 'base', params: null, dynamic: false },
            { start: 15, end: 28, raw: '{{ user.id }}', name: 'user.id', params: null, dynamic: false }
        ]);
    });

    test('finds dynamic tokens with their parameters and a $-prefixed name', () => {
        expect(tokenize('{{$uuid}} {{$randomInt:1:100}}')).toEqual([
            { start: 0, end: 9, raw: '{{$uuid}}', name: '$uuid', params: null, dynamic: true },
            { start: 10, end: 30, raw: '{{$randomInt:1:100}}', name: '$randomInt', params: '1:100', dynamic: true }
        ]);
    });

    test('accepts names with digits, dots and hyphens', () => {
        expect(tokenize('{{1st}}{{a-b}}{{a.b}}').map((t) => t.name)).toEqual(['1st', 'a-b', 'a.b']);
    });

    test('ignores malformed or invalid tokens', () => {
        expect(tokenize('{{}} {{ }} {{a b}} {{foo:bar}} {{$1x}} {{{x}}}').map((t) => t.raw)).toEqual(['{{x}}']);
    });

    test('matches exactly what VariableProcessor would resolve', () => {
        const processor = new VariableProcessor();
        const samples = ['{{a}}', '{{ a }}', '{{a.b-c}}', '{{$uuid}}', '{{$randomInt:1:5}}', '{{a b}}', '{{a:1}}', '{{$9}}', '{{}}'];
        for (const sample of samples) {
            const staticMatch = new RegExp(processor.VARIABLE_PATTERN.source).test(sample);
            const dynamicMatch = new RegExp(processor.DYNAMIC_VARIABLE_PATTERN.source).test(sample);
            expect([sample, tokenize(sample).length > 0]).toEqual([sample, staticMatch || dynamicMatch]);
        }
    });

    test('TOKEN_PATTERN is global and stateless across calls', () => {
        expect(TOKEN_PATTERN.flags).toContain('g');
        expect(tokenize('{{a}}')).toHaveLength(1);
        expect(tokenize('{{a}}')).toHaveLength(1);
    });
});

describe('maskValue', () => {
    test('masks secrets regardless of value', () => {
        expect(maskValue({ value: 'hunter2', secret: true })).toBe(SECRET_MASK);
    });

    test('collapses whitespace and truncates long values', () => {
        expect(maskValue({ value: 'a\n  b\tc' })).toBe('a b c');
        const long = 'x'.repeat(100);
        const masked = maskValue({ value: long });
        expect(masked).toHaveLength(48);
        expect(masked.endsWith('…')).toBe(true);
    });

    test('handles empty, null and non-string values', () => {
        expect(maskValue({ value: null })).toBe('');
        expect(maskValue(null)).toBe('');
        expect(maskValue({ value: 42 })).toBe('42');
    });
});

describe('scopeLabel', () => {
    test('describes each scope and uses the translator when given', () => {
        expect(scopeLabel({ scope: 'environment', envName: 'Dev' })).toBe('Environment "Dev"');
        expect(scopeLabel({ scope: 'environment', envName: null })).toBe('Environment');
        expect(scopeLabel({ scope: 'collection' })).toBe('Collection');
        expect(scopeLabel({ scope: 'dynamic' })).toBe('Dynamic');
        expect(scopeLabel({ scope: 'path-param' })).toBe('Path parameter');
        expect(scopeLabel({ scope: null })).toBe('Not defined');
        expect(scopeLabel({ scope: 'collection' }, (key) => key)).toBe('variables.scope.collection');
    });
});
