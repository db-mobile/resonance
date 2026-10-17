/* global document, window */
import { buildSchema, introspectionFromSchema } from 'graphql';

function markup() {
    return `
        <input id="url-input" value="">
        <div id="headers-list"></div>
        <div id="query-params-list"></div>
    `;
}

async function loadIntrospection({ url = 'https://api.example.com/graphql', pipeline } = {}) {
    document.body.innerHTML = markup();
    document.getElementById('url-input').value = url;
    jest.resetModules();

    const resolveRequestPipeline = jest.fn(async (input) => pipeline ?? { ok: true, url: `${input.url}#resolved`, authData: { headers: {} } });
    const attachAuthTransport = jest.fn();
    const attachClientCert = jest.fn();
    jest.doMock('../../src/modules/requestServices.js', () => ({
        resolveRequestPipeline,
        getRequestPipeline: () => ({ attachAuthTransport, attachClientCert })
    }));
    jest.doMock('../../src/modules/state/settingsCache.js', () => ({
        resolveRequestSettings: jest.fn(async () => ({ timeout: 5000, verifySsl: false, followRedirects: true }))
    }));

    const sendApiRequest = jest.fn();
    window.backendAPI = { sendApiRequest };
    const module = await import('../../src/modules/graphqlIntrospection.js');
    return { ...module, sendApiRequest, resolveRequestPipeline, attachAuthTransport, attachClientCert };
}

const VALID_INTROSPECTION = introspectionFromSchema(buildSchema('type Query { hello: String }'));

describe('fetchGraphQLIntrospection', () => {
    test('requires a URL', async () => {
        const { fetchGraphQLIntrospection, sendApiRequest } = await loadIntrospection({ url: '  ' });

        await expect(fetchGraphQLIntrospection()).resolves.toEqual({ error: 'Enter a URL before fetching the schema' });
        expect(sendApiRequest).not.toHaveBeenCalled();
    });

    test('propagates a pipeline failure', async () => {
        const { fetchGraphQLIntrospection } = await loadIntrospection({ pipeline: { ok: false, error: 'Variable processing error: x' } });

        await expect(fetchGraphQLIntrospection()).resolves.toEqual({ error: 'Variable processing error: x' });
    });

    test('sends a POST introspection query with auth, settings and client cert attached', async () => {
        const { fetchGraphQLIntrospection, sendApiRequest, attachAuthTransport, attachClientCert } = await loadIntrospection();
        sendApiRequest.mockResolvedValue({ success: true, data: { data: VALID_INTROSPECTION } });

        const result = await fetchGraphQLIntrospection();

        const config = sendApiRequest.mock.calls[0][0];
        expect(config).toEqual(expect.objectContaining({
            method: 'POST',
            url: 'https://api.example.com/graphql#resolved',
            rawUrl: 'https://api.example.com/graphql',
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000,
            verifySsl: false,
            followRedirects: true
        }));
        expect(config.body.query).toContain('__schema');
        expect(attachAuthTransport).toHaveBeenCalledWith(config, { headers: {} });
        expect(attachClientCert).toHaveBeenCalledWith(config);
        expect(result.url).toBe('https://api.example.com/graphql#resolved');
        expect(result.introspection).toBe(VALID_INTROSPECTION);
        expect(result.schema.getQueryType().getFields().hello).toBeDefined();
    });

    test('reports transport, HTTP, GraphQL and missing-schema failures', async () => {
        const { fetchGraphQLIntrospection, sendApiRequest } = await loadIntrospection();

        sendApiRequest.mockRejectedValueOnce(new Error('offline'));
        await expect(fetchGraphQLIntrospection()).resolves.toEqual({ error: 'Request failed: offline' });

        sendApiRequest.mockResolvedValueOnce({ success: false, status: 401, message: 'Unauthorized' });
        await expect(fetchGraphQLIntrospection()).resolves.toEqual({ error: 'Unauthorized (HTTP 401)' });

        sendApiRequest.mockResolvedValueOnce({ success: true, data: { errors: [{ message: 'denied' }] } });
        await expect(fetchGraphQLIntrospection()).resolves.toEqual({ error: 'GraphQL error: denied' });

        sendApiRequest.mockResolvedValueOnce({ success: true, data: { data: { nope: true } } });
        await expect(fetchGraphQLIntrospection()).resolves.toEqual({
            error: 'Response did not contain a GraphQL schema (introspection may be disabled)'
        });
    });
});

describe('buildSchemaFromIntrospection', () => {
    test('returns a schema for a valid introspection and null otherwise', async () => {
        const { buildSchemaFromIntrospection } = await loadIntrospection();

        expect(buildSchemaFromIntrospection(VALID_INTROSPECTION).getQueryType().name).toBe('Query');
        expect(buildSchemaFromIntrospection(null)).toBeNull();
        expect(buildSchemaFromIntrospection({ __schema: { broken: true } })).toBeNull();
    });
});
