import { ScriptService, SCRIPT_MUTABLE_REQUEST_FIELDS } from '../../src/modules/services/ScriptService.js';

describe('ScriptService._mergeModifiedRequest', () => {
    let service;

    beforeEach(() => {
        service = new ScriptService(null, null, null);
    });

    const baseConfig = () => ({
        url: 'https://api.example.com/users',
        method: 'GET',
        headers: { Accept: 'application/json' },
        body: null,
        queryParams: { page: '1' },
        pathParams: {},
        bodyType: 'json',
        verifySsl: true,
        auth: { type: 'bearer', token: 'secret' },
        clientCert: { certPath: '/tmp/client.pem' },
        timeout: 30000,
        followRedirects: true
    });

    it('applies allowlisted mutations from the script result', () => {
        const merged = service._mergeModifiedRequest(baseConfig(), {
            url: 'https://api.example.com/v2/users',
            method: 'POST',
            headers: { Accept: 'text/plain' },
            body: '{"a":1}',
            queryParams: { page: '2' },
            pathParams: { id: '42' }
        });

        expect(merged.url).toBe('https://api.example.com/v2/users');
        expect(merged.method).toBe('POST');
        expect(merged.headers).toEqual({ Accept: 'text/plain' });
        expect(merged.body).toBe('{"a":1}');
        expect(merged.queryParams).toEqual({ page: '2' });
        expect(merged.pathParams).toEqual({ id: '42' });
    });

    it('drops non-allowlisted fields a script injects into the request', () => {
        const merged = service._mergeModifiedRequest(baseConfig(), {
            url: 'https://attacker.example/collect',
            bodyType: 'binary',
            body: { filePath: '/home/user/.ssh/id_rsa' },
            verifySsl: false,
            clientCert: { certPath: '/tmp/evil.pem' },
            auth: { type: 'bearer', token: 'attacker' },
            timeout: 1,
            followRedirects: false
        });

        expect(merged.url).toBe('https://attacker.example/collect');
        expect(merged.body).toEqual({ filePath: '/home/user/.ssh/id_rsa' });
        expect(merged.bodyType).toBe('json');
        expect(merged.verifySsl).toBe(true);
        expect(merged.clientCert).toEqual({ certPath: '/tmp/client.pem' });
        expect(merged.auth).toEqual({ type: 'bearer', token: 'secret' });
        expect(merged.timeout).toBe(30000);
        expect(merged.followRedirects).toBe(true);
    });

    it('preserves config-only fields when the script mutates only allowlisted ones', () => {
        const merged = service._mergeModifiedRequest(baseConfig(), { method: 'DELETE' });

        expect(merged.method).toBe('DELETE');
        expect(merged.bodyType).toBe('json');
        expect(merged.verifySsl).toBe(true);
        expect(merged.auth).toEqual({ type: 'bearer', token: 'secret' });
    });

    it('leaves unmentioned allowlisted fields untouched', () => {
        const config = baseConfig();
        const merged = service._mergeModifiedRequest(config, { url: 'https://api.example.com/v2' });

        expect(merged.headers).toEqual(config.headers);
        expect(merged.queryParams).toEqual(config.queryParams);
    });

    it.each([undefined, null, 'string', 42, ['array'], true])(
        'returns the original config for non-object script result: %p',
        (badResult) => {
            const config = baseConfig();
            expect(service._mergeModifiedRequest(config, badResult)).toBe(config);
        }
    );

    it('does not mutate the original request config', () => {
        const config = baseConfig();
        service._mergeModifiedRequest(config, { url: 'https://changed.example', verifySsl: false });

        expect(config.url).toBe('https://api.example.com/users');
        expect(config.verifySsl).toBe(true);
    });

    it('ignores inherited (non-own) properties on the script result', () => {
        const proto = { verifySsl: false };
        const result = Object.create(proto);
        result.url = 'https://api.example.com/v2';

        const merged = service._mergeModifiedRequest(baseConfig(), result);

        expect(merged.url).toBe('https://api.example.com/v2');
        expect(merged.verifySsl).toBe(true);
    });
});

describe('SCRIPT_MUTABLE_REQUEST_FIELDS', () => {
    it('matches the fields seeded into the script request object', () => {
        expect([...SCRIPT_MUTABLE_REQUEST_FIELDS].sort()).toEqual(
            ['body', 'headers', 'method', 'pathParams', 'queryParams', 'url'].sort()
        );
    });

    it('is frozen', () => {
        expect(Object.isFrozen(SCRIPT_MUTABLE_REQUEST_FIELDS)).toBe(true);
    });
});
