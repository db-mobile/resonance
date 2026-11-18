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

describe('CurlParser basic auth', () => {
    test('-u produces the {type, config} auth shape the app persists', () => {
        const parsed = CurlParser.parse('curl -u alice:s3cret https://api.test');

        expect(parsed.auth).toEqual({ type: 'basic', config: { username: 'alice', password: 's3cret' } });
    });

    test('a colon inside the password is kept', () => {
        const parsed = CurlParser.parse('curl --user user:pa:ss https://api.test');

        expect(parsed.auth.config).toEqual({ username: 'user', password: 'pa:ss' });
    });

    test('a user without a password gets an empty password', () => {
        const parsed = CurlParser.parse('curl -u alice https://api.test');

        expect(parsed.auth.config).toEqual({ username: 'alice', password: '' });
    });
});

describe('CurlParser quoting', () => {
    test("$'…' decodes ANSI-C escapes", () => {
        const parsed = CurlParser.parse('curl -d $\'{"a":"it\\\'s"}\\n\\t\\x41\\u00e9\\101\' https://x.test');
        expect(parsed.body).toBe('{"a":"it\'s"}\n\tAéA');
        expect(parsed.url).toBe('https://x.test');
    });

    test('whitespace and newlines inside quotes are preserved', () => {
        const parsed = CurlParser.parse('curl -d \'{"a":  "b  c",\n\t"d": 1}\' -H "X-A: p  q" https://x.test');
        expect(parsed.body).toBe('{"a":  "b  c",\n\t"d": 1}');
        expect(parsed.headers['X-A']).toBe('p  q');
    });

    test('double quotes keep a backslash that escapes nothing', () => {
        const parsed = CurlParser.parse('curl -d "{\\"a\\":\\"x\\ny\\", \\"p\\": \\"\\$1\\"}" https://x.test');
        expect(parsed.body).toBe('{"a":"x\\ny", "p": "$1"}');
    });

    test('line continuations, tabs and newlines separate arguments', () => {
        const parsed = CurlParser.parse("curl 'https://x.test/a' \\\n  -H 'A: 1' \\\r\n\t-H 'B: 2'\n");
        expect(parsed.url).toBe('https://x.test/a');
        expect(parsed.headers).toEqual({ A: '1', B: '2' });
    });

    test('adjacent quoted pieces form one argument and an empty argument is kept', () => {
        const parsed = CurlParser.parse("curl -H 'X-A: '\"it's\"' ok' -d '' https://x.test");
        expect(parsed.headers['X-A']).toBe("it's ok");
        expect(parsed.method).toBe('POST');
    });
});

describe('CurlParser option forms', () => {
    test('short options accept an attached value', () => {
        const parsed = CurlParser.parse("curl -XPUT -H'Accept: x' -dfoo=1 -ualice:pw https://x.test");
        expect(parsed.method).toBe('PUT');
        expect(parsed.headers.Accept).toBe('x');
        expect(parsed.body).toBe('foo=1');
        expect(parsed.auth.config).toEqual({ username: 'alice', password: 'pw' });
    });

    test('long options accept =value', () => {
        const parsed = CurlParser.parse('curl --request=PATCH --header=Accept:x --data=a=1 https://x.test');
        expect(parsed.method).toBe('PATCH');
        expect(parsed.headers.Accept).toBe('x');
        expect(parsed.body).toBe('a=1');
    });

    test('bundled flags are read one by one, including a trailing value option', () => {
        const parsed = CurlParser.parse('curl -sSLIXDELETE https://x.test');
        expect(parsed.method).toBe('DELETE');
        expect(CurlParser.parse('curl -sSLI https://x.test').method).toBe('HEAD');
    });

    test('an explicit method survives a body', () => {
        expect(CurlParser.parse('curl -X GET -d a=1 https://x.test').method).toBe('GET');
        expect(CurlParser.parse('curl -d a=1 -X GET https://x.test').method).toBe('GET');
    });

    test('--json sends the body as JSON and keeps headers that were given', () => {
        const parsed = CurlParser.parse('curl --json \'{"a":1}\' https://x.test');
        expect(parsed.method).toBe('POST');
        expect(parsed.body).toBe('{"a":1}');
        expect(parsed.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });

        const custom = CurlParser.parse('curl -H "accept: text/plain" --json {} https://x.test');
        expect(custom.headers).toEqual({ accept: 'text/plain', 'Content-Type': 'application/json' });
    });

    test.each(['-G', '--get'])('%s moves the data into the query string', (flag) => {
        const parsed = CurlParser.parse(`curl ${flag} -d q=1 --data-urlencode 'name=a b' 'https://x.test/s?page=2'`);
        expect(parsed.method).toBe('GET');
        expect(parsed.body).toBeNull();
        expect(parsed.queryParams).toEqual({ page: '2', q: '1', name: 'a b' });
        expect(parsed.url).toBe('https://x.test/s');
    });

    test('-F builds multipart rows with files and content types', () => {
        const parsed = CurlParser.parse(
            "curl -F name=Rex -F 'photo=@/tmp/a b.png;type=image/png' --form 'note=\"x;y\"' --form-string 'raw=@not;a=file' https://x.test/pets"
        );
        expect(parsed.method).toBe('POST');
        expect(parsed.body).toBeNull();
        expect(parsed.formBody).toEqual({ mode: 'formdata', fields: [
            { key: 'name', value: 'Rex', type: 'text', filePath: '', contentType: '', enabled: true },
            { key: 'photo', value: '', type: 'file', filePath: '/tmp/a b.png', contentType: 'image/png', enabled: true },
            { key: 'note', value: 'x;y', type: 'text', filePath: '', contentType: '', enabled: true },
            { key: 'raw', value: '@not;a=file', type: 'text', filePath: '', contentType: '', enabled: true }
        ] });
        expect(CurlParser.toEndpoint(parsed).formBody).toBe(parsed.formBody);
        expect(CurlParser.toEndpoint(parsed).requestBody).toBeNull();
    });

    test('the value of an option that is not imported is never taken as the URL', () => {
        for (const option of ['--proxy http://proxy:8080', '-x http://proxy:8080', '--cacert ca.pem', '-o out.json', '--max-time 5']) {
            expect(CurlParser.parse(`curl ${option} https://x.test/a`).url).toBe('https://x.test/a');
        }
    });

    test('an unknown flag does not swallow the next argument', () => {
        expect(CurlParser.parse('curl --some-new-flag https://x.test/a -H "A: 1"').headers).toEqual({ A: '1' });
        expect(CurlParser.parse('curl --some-new-flag value https://x.test/a').url).toBe('https://x.test/a');
    });

    test.each(['localhost:3000/api', '127.0.0.1:8080/x', 'myhost/api'])('%s is accepted as the URL', (url) => {
        expect(CurlParser.parse(`curl -s ${url}`).url).toBe(url);
    });

    test('a command without a URL is rejected', () => {
        expect(() => CurlParser.parse('curl -s -H "A: 1"')).toThrow('No URL found');
    });
});

describe('CurlParser query string', () => {
    test('a value keeps everything after the first =', () => {
        expect(CurlParser.parse("curl 'https://x.test?q=a=b&t=x%3Dy'").queryParams).toEqual({ q: 'a=b', t: 'x=y' });
    });

    test('a malformed escape is kept as written instead of throwing', () => {
        expect(CurlParser.parse("curl 'https://x.test?q=100%&r=%E0%A4%A&ok=a%20b'").queryParams)
            .toEqual({ q: '100%', r: '%E0%A4%A', ok: 'a b' });
    });

    test('a fragment is not part of the last value', () => {
        const parsed = CurlParser.parse("curl 'https://x.test/p?a=1#frag'");
        expect(parsed.queryParams).toEqual({ a: '1' });
        expect(parsed.url).toBe('https://x.test/p');
    });
});
