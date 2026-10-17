/* global window */

async function loadRequestServices({ authConfig = { type: 'none', config: {} }, resolveVariables, processRequestComponents } = {}) {
    jest.resetModules();

    const getAuthConfig = jest.fn(() => authConfig);
    jest.doMock('../../src/modules/authManager.js', () => ({
        setOAuthVariableResolver: jest.fn()
    }));

    const { VariableProcessor } = await import('../../src/modules/variables/VariableProcessor.js');
    const { RequestPipeline } = await import('../../src/modules/services/RequestPipeline.js');
    const processor = new VariableProcessor();
    const builder = {
        resolveVariables: resolveVariables || jest.fn(async () => ({ variables: { host: 'h' }, processor })),
        mergeAuthData: jest.fn((headers, queryParams, authData) => {
            Object.assign(headers, authData.headers);
            Object.assign(queryParams, authData.queryParams);
        }),
        processRequestComponents: processRequestComponents || jest.fn(({ url }) => ({ url: `${url}?done`, queryString: 'done', pathParams: {} }))
    };
    const pipeline = new RequestPipeline({
        backendAPI: {},
        collectionRepository: { getInheritedAuth: jest.fn(async () => ({ authConfig: null, source: null })) },
        variableRepository: {},
        environmentRepository: {},
        requestBuilder: builder,
        mockServerService: {}
    });

    window.backendAPI = {};
    const services = await import('../../src/modules/requestServices.js');
    const { app } = await import('../../src/modules/appContext.js');
    app.authManager = { getAuthConfig, applyTokenResult: jest.fn() };
    services.setRequestPipeline(pipeline);
    return { ...services, builder, processor, getAuthConfig, pipeline };
}

describe('resolveRequestPipeline', () => {
    test('returns the processed components with merged auth data', async () => {
        const { resolveRequestPipeline, builder, processor } = await loadRequestServices({
            authConfig: { type: 'bearer', config: { token: 't' } }
        });
        const headers = { 'X-A': '1' };
        const queryParams = {};
        const queryRows = [{ key: 'page', value: '1', enabled: true }];

        const result = await resolveRequestPipeline({ url: 'https://x', headers, queryParams, queryRows });

        expect(result).toEqual({
            ok: true,
            url: 'https://x?done',
            queryString: 'done',
            pathParams: {},
            headers: { 'X-A': '1', Authorization: 'Bearer t' },
            queryParams: {},
            variables: { host: 'h' },
            processor,
            authData: expect.objectContaining({ headers: { Authorization: 'Bearer t' }, unresolvedVariables: [] })
        });
        expect(builder.processRequestComponents).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://x', headers, queryParams, queryRows, variables: { host: 'h' }, processor
        }));
    });

    test('appends auth query params as rows without duplicating existing keys', async () => {
        const { resolveRequestPipeline } = await loadRequestServices({
            authConfig: { type: 'api-key', config: { keyName: 'api_key', keyValue: 'k', location: 'query' } }
        });
        const queryRows = [{ key: 'api_key', value: 'mine', enabled: true }];

        await resolveRequestPipeline({ url: 'https://x', headers: {}, queryParams: {}, queryRows });
        expect(queryRows).toEqual([{ key: 'api_key', value: 'mine', enabled: true }]);

        const emptyRows = [];
        await resolveRequestPipeline({ url: 'https://x', headers: {}, queryParams: {}, queryRows: emptyRows });
        expect(emptyRows).toEqual([{ key: 'api_key', value: 'k', enabled: true }]);
    });

    test('skips auth entirely when useAuth is false', async () => {
        const { resolveRequestPipeline, builder, getAuthConfig } = await loadRequestServices();
        const headers = {};

        const result = await resolveRequestPipeline({ url: 'https://x', headers, queryParams: {}, useAuth: false });

        expect(getAuthConfig).not.toHaveBeenCalled();
        expect(builder.mergeAuthData).not.toHaveBeenCalled();
        expect(result.authData).toBeNull();
        expect(headers).toEqual({});
    });

    test('wraps variable resolution failures in an error envelope', async () => {
        const { resolveRequestPipeline } = await loadRequestServices({
            resolveVariables: jest.fn(async () => { throw new Error('bad env'); })
        });

        const result = await resolveRequestPipeline({ url: 'https://x', headers: {}, queryParams: {} });

        expect(result).toEqual({ ok: false, error: 'Variable processing error: bad env' });
    });

    test('throws a clear error when no pipeline has been installed', async () => {
        const { setRequestPipeline, getRequestPipeline } = await loadRequestServices();
        setRequestPipeline(null);

        expect(() => getRequestPipeline()).toThrow('Request pipeline is not initialised');
    });

    test('persists a renewed OAuth token to its pinned endpoint after the editor switches requests', async () => {
        const authConfig = {
            type: 'oauth2', config: {
                token: 'old', refreshToken: 'refresh', expiresAt: Date.now() - 1000,
                tokenUrl: 'https://auth.test/token', clientId: 'client', clientSecret: '{{secret}}'
            }
        };
        const { generateEffectiveAuthData, pipeline, processor } = await loadRequestServices({ authConfig });
        const { setCurrentEndpoint } = await import('../../src/modules/state/currentEndpoint.js');
        const { app } = await import('../../src/modules/appContext.js');
        let completeRenewal;
        let notifyStarted;
        const started = new Promise(resolve => { notifyStarted = resolve; });
        const renewal = new Promise(resolve => { completeRenewal = resolve; });
        pipeline.backendAPI.oauth2 = { getToken: jest.fn(() => { notifyStarted(); return renewal; }) };
        pipeline.collectionRepository.saveAuthConfigAtSource = jest.fn().mockResolvedValue(undefined);
        setCurrentEndpoint({ collectionId: 'original-collection', endpointId: 'original-request' });

        const resolving = generateEffectiveAuthData({ variables: { secret: 'resolved-secret' }, processor });
        await started;
        setCurrentEndpoint({ collectionId: 'other-collection', endpointId: 'other-request' });
        completeRenewal({ success: true, accessToken: 'renewed', expiresIn: 3600 });
        const authData = await resolving;

        expect(authData.headers.Authorization).toBe('Bearer renewed');
        expect(pipeline.collectionRepository.saveAuthConfigAtSource).toHaveBeenCalledWith(
            'original-collection', 'original-request', { kind: 'request' },
            expect.objectContaining({
                type: 'oauth2', config: expect.objectContaining({ token: 'renewed', clientSecret: '{{secret}}' })
            })
        );
        expect(app.authManager.applyTokenResult).not.toHaveBeenCalled();
        setCurrentEndpoint(null);
    });
});
