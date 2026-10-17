import { RequestPipeline } from '../../src/modules/services/RequestPipeline.js';
import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';
import { RequestBuilderService } from '../../src/modules/services/RequestBuilderService.js';

function makePipeline(overrides = {}) {
    const deps = {
        backendAPI: { oauth2: { getToken: jest.fn() } },
        collectionRepository: {
            getById: jest.fn(async () => ({ id: 'c1', endpoints: [{ id: 'e1', path: '/users/{id}' }], folders: [] })),
            getInheritedAuth: jest.fn(async () => ({ authConfig: { type: 'bearer', config: { token: 'inherited' } }, source: { kind: 'collection' } })),
            saveAuthConfigAtSource: jest.fn(async () => {})
        },
        variableRepository: {},
        environmentRepository: {},
        requestBuilder: new RequestBuilderService(null, null),
        mockServerService: { shouldUseMockServer: jest.fn(async () => ({ shouldUseMock: false, mockBaseUrl: null })) },
        certificates: { getForHost: jest.fn((host) => (host === 'api.test' ? { certPath: '/c.pem' } : null)) },
        cookies: { getCookieHeader: jest.fn(async () => 'sid=1') },
        ...overrides
    };
    return { pipeline: new RequestPipeline(deps), deps };
}

const processor = new VariableProcessor();
const ENDPOINT = { collectionId: 'c1', endpointId: 'e1' };

describe('RequestPipeline construction', () => {
    test('rejects a missing required dependency by name', () => {
        expect(() => new RequestPipeline({ backendAPI: {} })).toThrow('missing dependency "collectionRepository"');
    });

    test('treats certificates and cookies as optional', () => {
        const { pipeline } = makePipeline({ certificates: undefined, cookies: undefined });
        expect(pipeline.certificates).toBeNull();
        expect(pipeline.cookies).toBeNull();
    });
});

describe('RequestPipeline.resolveAuth', () => {
    test('substitutes variables into the request auth and reports unresolved names', async () => {
        const { pipeline, deps } = makePipeline();

        const { authData, source, warnings } = await pipeline.resolveAuth({
            authConfig: { type: 'bearer', config: { token: '{{key}} {{missing}}' } },
            endpoint: ENDPOINT,
            variables: { key: 's3cret' },
            processor
        });

        expect(authData.headers).toEqual({ Authorization: 'Bearer s3cret {{missing}}' });
        expect(authData.unresolvedVariables).toEqual(['missing']);
        expect(source).toEqual({ kind: 'request' });
        expect(warnings).toEqual([]);
        expect(deps.collectionRepository.getInheritedAuth).not.toHaveBeenCalled();
    });

    test('resolves inherited auth through the collection repository', async () => {
        const { pipeline, deps } = makePipeline();

        const { authData, source } = await pipeline.resolveAuth({
            authConfig: { type: 'inherit', config: {} },
            endpoint: ENDPOINT,
            variables: {},
            processor
        });

        expect(deps.collectionRepository.getInheritedAuth).toHaveBeenCalledWith('c1', 'e1');
        expect(authData.headers).toEqual({ Authorization: 'Bearer inherited' });
        expect(source).toEqual({ kind: 'collection' });
    });

    test('applies the bearer fallback only when asked', async () => {
        const { pipeline } = makePipeline();
        const authConfig = { type: 'bearer', config: { token: '' } };
        const variables = { bearerToken: 'fallback' };

        const plain = await pipeline.resolveAuth({ authConfig, endpoint: ENDPOINT, variables, processor });
        const withFallback = await pipeline.resolveAuth({ authConfig, endpoint: ENDPOINT, variables, processor, bearerFallback: true });

        expect(plain.authData.headers).toEqual({});
        expect(withFallback.authData.headers).toEqual({ Authorization: 'Bearer fallback' });
    });

    test('refreshes an expired OAuth token and persists request-level auth through the callback', async () => {
        const { pipeline, deps } = makePipeline();
        deps.backendAPI.oauth2.getToken.mockResolvedValue({ success: true, accessToken: 'fresh', expiresIn: 3600 });
        const persistRequestAuth = jest.fn();
        const authConfig = {
            type: 'oauth2',
            config: { grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', token: 'stale', expiresAt: 1 }
        };

        const { authData, warnings } = await pipeline.resolveAuth({
            authConfig, endpoint: ENDPOINT, variables: {}, processor, persistRequestAuth
        });

        expect(deps.backendAPI.oauth2.getToken).toHaveBeenCalledTimes(1);
        expect(authData.headers).toEqual({ Authorization: 'Bearer fresh' });
        expect(persistRequestAuth).toHaveBeenCalledTimes(1);
        expect(deps.collectionRepository.saveAuthConfigAtSource).not.toHaveBeenCalled();
        expect(warnings).toEqual([]);
    });

    test('persists an inherited OAuth renewal at its source when no request callback is given', async () => {
        const { pipeline, deps } = makePipeline();
        deps.collectionRepository.getInheritedAuth.mockResolvedValue({
            authConfig: { type: 'oauth2', config: { grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', token: 'stale', expiresAt: 1 } },
            source: { kind: 'collection' }
        });
        deps.backendAPI.oauth2.getToken.mockResolvedValue({ success: true, accessToken: 'fresh', expiresIn: 3600 });

        await pipeline.resolveAuth({ authConfig: { type: 'inherit', config: {} }, endpoint: ENDPOINT, variables: {}, processor });

        expect(deps.collectionRepository.saveAuthConfigAtSource).toHaveBeenCalledWith('c1', 'e1', { kind: 'collection' }, expect.objectContaining({ type: 'oauth2' }));
    });

    test('skips the refresh when asked and surfaces a failed renewal as a warning', async () => {
        const { pipeline, deps } = makePipeline();
        const authConfig = {
            type: 'oauth2',
            config: { grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', clientId: 'id', token: 'stale', expiresAt: 1 }
        };

        const skipped = await pipeline.resolveAuth({ authConfig, endpoint: ENDPOINT, variables: {}, processor, refreshOAuth: false });
        expect(deps.backendAPI.oauth2.getToken).not.toHaveBeenCalled();
        expect(skipped.authData.headers).toEqual({ Authorization: 'Bearer stale' });

        deps.backendAPI.oauth2.getToken.mockRejectedValue(new Error('auth server down'));
        const failed = await pipeline.resolveAuth({ authConfig, endpoint: ENDPOINT, variables: {}, processor });
        expect(failed.warnings).toHaveLength(1);
        expect(failed.warnings[0]).toContain('auth server down');
    });
});

describe('RequestPipeline mock rewrite', () => {
    test('passes the URL through when the mock server is off or the endpoint is unknown', async () => {
        const { pipeline } = makePipeline();

        await expect(pipeline.resolveMockRewrite({ endpoint: null, url: 'https://x', queryString: '', pathParams: {} }))
            .resolves.toEqual({ url: 'https://x', mockRewrite: null });
        await expect(pipeline.resolveMockRewrite({ endpoint: ENDPOINT, url: 'https://x', queryString: '', pathParams: {} }))
            .resolves.toEqual({ url: 'https://x', mockRewrite: null });
    });

    test('rewrites onto the mock base URL using the endpoint path template', async () => {
        const { pipeline, deps } = makePipeline();
        deps.mockServerService.shouldUseMockServer.mockResolvedValue({ shouldUseMock: true, mockBaseUrl: 'http://127.0.0.1:9' });

        const result = await pipeline.resolveMockRewrite({ endpoint: ENDPOINT, url: 'https://x/users/42?q=1', queryString: 'q=1', pathParams: { id: '42' } });

        expect(result).toEqual({ url: 'http://127.0.0.1:9/users/42?q=1', mockRewrite: { baseUrl: 'http://127.0.0.1:9', pathTemplate: '/users/{id}' } });
    });

    test('uses an explicit base URL and path instead of looking them up', async () => {
        const { pipeline, deps } = makePipeline();

        const result = await pipeline.resolveMockRewrite({
            endpoint: ENDPOINT, url: 'https://x', queryString: '', pathParams: {}, mockBaseUrl: 'http://m', endpointPath: '/p'
        });

        expect(result.url).toBe('http://m/p');
        expect(deps.mockServerService.shouldUseMockServer).not.toHaveBeenCalled();
        expect(deps.collectionRepository.getById).not.toHaveBeenCalled();
    });

    test('a failing mock lookup falls back to the real URL with a warning', async () => {
        const { pipeline, deps } = makePipeline();
        deps.mockServerService.shouldUseMockServer.mockRejectedValue(new Error('store down'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(pipeline.mockBaseUrlFor('c1')).resolves.toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('RequestPipeline config assembly', () => {
    const settings = { httpVersion: 'auto', timeout: 30000, verifySsl: true, followRedirects: true };

    test('whitelists bodyType and attaches only the auth transports that are set', () => {
        const { pipeline } = makePipeline();

        const config = pipeline.assembleRequestConfig({
            protocol: 'http', method: 'POST', url: 'https://x', rawUrl: 'https://x', headers: {}, queryParams: {}, pathParams: {},
            body: undefined, bodyType: 'json', settings, authData: { headers: {}, queryParams: {}, authConfig: null, awsAuth: { region: 'eu' } }
        });

        expect(config.bodyType).toBeUndefined();
        expect(config.awsAuth).toEqual({ region: 'eu' });
        expect(config).not.toHaveProperty('auth');
        expect(config).not.toHaveProperty('ntlm');
        expect(config).toMatchObject({ httpVersion: 'auto', timeout: 30000, verifySsl: true, followRedirects: true });

        const form = pipeline.assembleRequestConfig({ protocol: 'http', method: 'POST', url: 'u', rawUrl: 'u', headers: {}, queryParams: {}, pathParams: {}, body: [], bodyType: 'formdata', settings, authData: { headers: {}, queryParams: {} } });
        expect(form.bodyType).toBe('formdata');
    });

    test('applyScriptMutations rebuilds the URL and reports stripped cross-origin auth', () => {
        const { pipeline } = makePipeline();
        const authData = { headers: { Authorization: 'Bearer t' }, queryParams: {} };
        const requestConfig = { url: 'https://other.test/users/42', headers: { Authorization: 'Bearer t' }, queryParams: { q: '1' }, pathParams: { id: '42' }, auth: null };
        const snapshot = { url: 'https://api.test/users/42', queryParams: { q: '1' }, pathParams: { id: '42' } };

        const stripped = pipeline.applyScriptMutations(requestConfig, { snapshot, rawUrl: 'https://api.test/users/{id}', variables: {}, processor, mockRewrite: null, authData });

        expect(stripped).toBe(true);
        expect(requestConfig.headers).toEqual({});
        expect(requestConfig.url).toBe('https://other.test/users/42');
    });

    test('finalize attaches the client cert for the host and a cookie header without clobbering one', async () => {
        const { pipeline, deps } = makePipeline();
        const config = { url: 'https://api.test/x', headers: {} };
        await pipeline.finalize(config);
        expect(config.clientCert).toEqual({ certPath: '/c.pem' });
        expect(config.headers.Cookie).toBe('sid=1');

        const withCookie = { url: 'https://api.test/x', headers: { cookie: 'mine' } };
        await pipeline.finalize(withCookie);
        expect(withCookie.headers).toEqual({ cookie: 'mine' });

        const elsewhere = { url: 'https://elsewhere.test/x', headers: {} };
        await pipeline.finalize(elsewhere);
        expect(elsewhere).not.toHaveProperty('clientCert');
        expect(deps.certificates.getForHost).toHaveBeenCalledWith('elsewhere.test');
    });

    test('finalize tolerates missing certificate and cookie sources', async () => {
        const { pipeline } = makePipeline({ certificates: null, cookies: null });
        const config = { url: 'https://api.test/x' };

        await pipeline.finalize(config);

        expect(config).toEqual({ url: 'https://api.test/x' });
    });
});
