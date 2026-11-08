import {
    exampleFromTab,
    exampleHeaders,
    defaultExampleName,
    uniqueExampleName,
    newExampleId,
    MAX_EXAMPLE_BODY_CHARS,
    STRIPPED_HEADERS
} from '../../src/modules/examples/exampleFromResponse.js';

const NOW = () => new Date('2026-11-08T10:15:00.000Z');

function tab(overrides = {}) {
    return {
        id: 't1',
        endpoint: { collectionId: 'c1', endpointId: 'e1' },
        request: { protocol: 'http' },
        response: {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'content-length': '12', date: 'now', 'set-cookie': 'a=b', 'x-request-id': 'r1' },
            data: { id: 42, name: 'Ada' },
            isJson: true,
            isBinary: false,
            truncated: false
        },
        ...overrides
    };
}

describe('exampleFromTab', () => {
    test('captures status, filtered lowercase headers, content type and a pretty JSON body', () => {
        const result = exampleFromTab(tab(), { now: NOW, id: () => 'ex1' });

        expect(result).toEqual({
            ok: true,
            example: {
                id: 'ex1',
                name: '',
                status: 200,
                statusText: 'OK',
                headers: [
                    { key: 'content-type', value: 'application/json; charset=utf-8' },
                    { key: 'x-request-id', value: 'r1' }
                ],
                contentType: 'application/json; charset=utf-8',
                body: '{\n  "id": 42,\n  "name": "Ada"\n}',
                savedAt: '2026-11-08T10:15:00.000Z'
            }
        });
    });

    test('keeps text bodies verbatim, turns empty data into an empty body and binary into base64', () => {
        const text = exampleFromTab(tab({ response: { status: 404, headers: {}, data: 'not found', isJson: false } }), { now: NOW, id: () => 'x' });
        expect(text.example.body).toBe('not found');
        expect(text.example.statusText).toBeUndefined();
        expect(text.example.contentType).toBeUndefined();

        const empty = exampleFromTab(tab({ response: { status: 204, headers: {}, data: null } }), { now: NOW, id: () => 'x' });
        expect(empty.example.body).toBe('');

        const binary = exampleFromTab(tab({ response: { status: 200, headers: { 'content-type': 'image/png' }, isBinary: true, bodyBase64: 'AAAA' } }), { now: NOW, id: () => 'x' });
        expect(binary.example).toMatchObject({ body: 'AAAA', bodyEncoding: 'base64', contentType: 'image/png' });
    });

    test.each([
        ['unbound', tab({ endpoint: null })],
        ['unbound', tab({ endpoint: { collectionId: 'c1' } })],
        ['protocol', tab({ request: { protocol: 'websocket' } })],
        ['protocol', tab({ request: { protocol: 'grpc' } })],
        ['no_response', tab({ response: null })],
        ['no_response', tab({ response: { status: null, data: 'x' } })],
        ['truncated', tab({ response: { status: 200, data: 'x', truncated: true } })],
        ['truncated', tab({ response: { status: 200, isBinary: true, bodyBase64: null } })],
        ['too_large', tab({ response: { status: 200, data: 'x'.repeat(MAX_EXAMPLE_BODY_CHARS + 1) } })]
    ])('refuses with %s', (reason, input) => {
        expect(exampleFromTab(input, { now: NOW })).toEqual({ ok: false, reason });
    });

    test('accepts graphql tabs and a missing tab is unbound', () => {
        expect(exampleFromTab(tab({ request: { protocol: 'graphql' } }), { now: NOW }).ok).toBe(true);
        expect(exampleFromTab(null)).toEqual({ ok: false, reason: 'unbound' });
    });

    test('generates distinct ids with the timestamp prefix', () => {
        const a = newExampleId(NOW);
        const b = newExampleId(NOW);
        expect(a).toMatch(new RegExp(`^ex_${NOW().getTime()}_[a-z0-9]{7}$`));
        expect(a).not.toBe(b);
    });
});

describe('exampleHeaders', () => {
    test('strips hop-by-hop and cookie headers and lowercases names', () => {
        const rows = exampleHeaders({ 'X-A': 1, 'Transfer-Encoding': 'chunked', Connection: 'close', 'Keep-Alive': 'x', '': 'y' });
        expect(rows).toEqual([{ key: 'x-a', value: '1' }]);
        expect(STRIPPED_HEADERS).toContain('set-cookie');
        expect(exampleHeaders(null)).toEqual([]);
    });
});

describe('naming', () => {
    test('defaultExampleName prefers the status line and falls back to a counter', () => {
        expect(defaultExampleName({ status: 201, statusText: 'Created' }, [])).toBe('201 Created');
        expect(defaultExampleName({ status: 200 }, [])).toBe('200');
        expect(defaultExampleName({ status: 0 }, [{}, {}])).toBe('0');
    });

    test('uniqueExampleName appends a counter until the name is free', () => {
        const existing = [{ name: '200 OK' }, { name: '200 OK (2)' }];
        expect(uniqueExampleName('200 OK', existing)).toBe('200 OK (3)');
        expect(uniqueExampleName('404', existing)).toBe('404');
    });
});
