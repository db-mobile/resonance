import { CurlParser } from '../src/modules/CurlParser.js';

describe('CurlParser head flag', () => {
    test('-I selects HEAD', () => {
        expect(CurlParser.parse('curl -I https://api.test/users').method).toBe('HEAD');
    });

    test('--head selects HEAD', () => {
        expect(CurlParser.parse('curl --head https://api.test/users').method).toBe('HEAD');
    });

    test('-I directly before the URL does not swallow it', () => {
        const request = CurlParser.parse('curl -I https://api.test/users');
        expect(request.url).toBe('https://api.test/users');
    });

    test('an explicit -X wins over -I in either order', () => {
        expect(CurlParser.parse('curl -I -X OPTIONS https://api.test').method).toBe('OPTIONS');
        expect(CurlParser.parse('curl -X OPTIONS -I https://api.test').method).toBe('OPTIONS');
    });
});

describe('CurlParser data flags', () => {
    test('--data-urlencode keeps the name and encodes only the content', () => {
        const parsed = CurlParser.parse("curl --data-urlencode 'name=John Doe' https://x.com");

        expect(parsed.body).toBe('name=John%20Doe');
        expect(parsed.method).toBe('POST');
    });

    test('--data-urlencode with a leading = encodes the content alone', () => {
        const parsed = CurlParser.parse("curl --data-urlencode '=a&b' https://x.com");

        expect(parsed.body).toBe('a%26b');
    });

    test('--data-urlencode without separators encodes the whole token', () => {
        const parsed = CurlParser.parse("curl --data-urlencode 'a b' https://x.com");

        expect(parsed.body).toBe('a%20b');
    });

    test('--data-urlencode file forms pass through unchanged', () => {
        const parsed = CurlParser.parse("curl --data-urlencode 'name@file.txt' https://x.com");

        expect(parsed.body).toBe('name@file.txt');
    });

    test('multiple --data-urlencode flags join with &', () => {
        const parsed = CurlParser.parse(
            "curl --data-urlencode 'name=John Doe' --data-urlencode 'city=NY' https://x.com"
        );

        expect(parsed.body).toBe('name=John%20Doe&city=NY');
    });

    test('repeated -d flags accumulate instead of overwriting', () => {
        const parsed = CurlParser.parse('curl -d a=1 -d b=2 https://x.com');

        expect(parsed.body).toBe('a=1&b=2');
    });

    test('-d and --data-urlencode interleave in order', () => {
        const parsed = CurlParser.parse(
            "curl -d raw=1 --data-urlencode 'q=a b' https://x.com"
        );

        expect(parsed.body).toBe('raw=1&q=a%20b');
    });
});
