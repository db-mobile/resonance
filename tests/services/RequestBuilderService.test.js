import { RequestBuilderService } from '../../src/modules/services/RequestBuilderService.js';
import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';

describe('RequestBuilderService', () => {
    let service;
    let processor;

    beforeEach(() => {
        service = new RequestBuilderService(() => null, () => null);
        processor = new VariableProcessor();
        processor.clearDynamicCache();
    });

    describe('buildQueryString', () => {
        it('encodes keys and values', () => {
            expect(service.buildQueryString({ 'a b': 'c d' })).toBe('a%20b=c%20d');
        });

        it('skips empty keys', () => {
            expect(service.buildQueryString({ '': 'x', a: '1' })).toBe('a=1');
        });

        it('preserves already-encoded values', () => {
            expect(service.buildQueryString({ a: 'x%20y' })).toBe('a=x%20y');
        });

        it('coerces non-string values instead of throwing', () => {
            expect(service.buildQueryString({ n: 5, b: true })).toBe('n=5&b=true');
        });

        it('treats null and undefined values as empty strings', () => {
            expect(service.buildQueryString({ a: null, b: undefined })).toBe('a=&b=');
        });
    });

    describe('processRequestComponents', () => {
        it('returns the variable-resolved path parameter map', () => {
            const result = service.processRequestComponents({
                url: 'https://api.example.com/users/{{id}}',
                pathParams: { id: '{{userId}}' },
                headers: {},
                queryParams: {},
                variables: { userId: '42' },
                processor
            });

            expect(result.pathParams).toEqual({ id: '42' });
            expect(result.url).toBe('https://api.example.com/users/42');
        });
    });

    describe('applyScriptParamMutations', () => {
        const bake = (rawUrl, pathParams, queryParams, variables = {}) => {
            const headers = {};
            const params = { ...queryParams };
            const result = service.processRequestComponents({
                url: rawUrl,
                pathParams,
                headers,
                queryParams: params,
                variables,
                processor
            });
            return { url: result.url, queryParams: params, pathParams: result.pathParams };
        };

        const snapshotOf = (baked) => ({
            url: baked.url,
            queryParams: { ...baked.queryParams },
            pathParams: { ...baked.pathParams }
        });

        it('returns the URL unchanged when the script touched nothing', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1' });
            const requestConfig = { ...baked };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://api.example.com/users?a=1');
        });

        it('rebuilds the query string when the script mutates queryParams', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1' });
            const requestConfig = {
                ...baked,
                queryParams: { ...baked.queryParams, token: 'abc' }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://api.example.com/users?a=1&token=abc');
        });

        it('strips the query when the script empties queryParams', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1' });
            const requestConfig = { ...baked, queryParams: {} };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://api.example.com/users');
        });

        it('drops parameters a script set to null', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1', b: '2' });
            const requestConfig = {
                ...baked,
                queryParams: { ...baked.queryParams, a: null }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://api.example.com/users?b=2');
        });

        it('lets an explicit request.url edit supply the base for mutated queryParams', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1' });
            const requestConfig = {
                ...baked,
                url: 'https://other.example.com/items?inline=1',
                queryParams: { ...baked.queryParams, token: 'abc' }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://other.example.com/items?a=1&token=abc');
        });

        it('leaves an explicit request.url edit alone when params are untouched', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1' });
            const requestConfig = {
                ...baked,
                url: 'https://other.example.com/items?inline=1'
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://other.example.com/items?inline=1');
        });

        it('re-bakes the URL from the raw template when the script mutates pathParams', () => {
            const baked = bake('https://api.example.com/users/{{id}}', { id: '1' }, { a: '1' });
            const requestConfig = {
                ...baked,
                pathParams: { id: '2' }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users/{{id}}',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://api.example.com/users/2?a=1');
        });

        it('resolves environment variables and keeps dynamic variable values stable on re-bake', () => {
            const variables = { host: 'api.example.com' };
            const baked = bake('{{host}}/v/{{$uuid}}/users/{{id}}', { id: '1' }, {}, variables);
            const originalUuid = baked.url.match(/\/v\/([^/]+)\//)[1];
            const requestConfig = {
                ...baked,
                pathParams: { id: '2' }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: '{{host}}/v/{{$uuid}}/users/{{id}}',
                variables,
                processor,
                mockRewrite: null
            });

            expect(url).toBe(`https://api.example.com/v/${originalUuid}/users/2`);
        });

        it('lets an explicit request.url edit win over pathParams changes', () => {
            const baked = bake('https://api.example.com/users/{{id}}', { id: '1' }, {});
            const requestConfig = {
                ...baked,
                url: 'https://other.example.com/items',
                pathParams: { id: '2' }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users/{{id}}',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(url).toBe('https://other.example.com/items');
        });

        it('re-applies mutated pathParams to the mock-server path template', () => {
            const baked = bake('https://api.example.com/users/{{id}}', { id: '1' }, { a: '1' });
            const mockUrl = 'http://localhost:3000/users/1?a=1';
            const requestConfig = {
                ...baked,
                url: mockUrl,
                pathParams: { id: '2' }
            };
            const snapshot = { ...snapshotOf(baked), url: mockUrl };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot,
                rawUrl: 'https://api.example.com/users/{{id}}',
                variables: {},
                processor,
                mockRewrite: { baseUrl: 'http://localhost:3000', pathTemplate: '/users/{id}' }
            });

            expect(url).toBe('http://localhost:3000/users/2?a=1');
        });

        it('normalizes script-supplied param values in place', () => {
            const baked = bake('https://api.example.com/users', {}, {});
            const requestConfig = {
                ...baked,
                queryParams: { n: 5, o: { a: 1 } }
            };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(requestConfig.queryParams).toEqual({ n: '5', o: '{"a":1}' });
            expect(url).toBe('https://api.example.com/users?n=5&o=%7B%22a%22%3A1%7D');
        });

        it('treats a non-object queryParams reassignment as an empty map', () => {
            const baked = bake('https://api.example.com/users', {}, { a: '1' });
            const requestConfig = { ...baked, queryParams: 'garbage' };

            const url = service.applyScriptParamMutations({
                requestConfig,
                snapshot: snapshotOf(baked),
                rawUrl: 'https://api.example.com/users',
                variables: {},
                processor,
                mockRewrite: null
            });

            expect(requestConfig.queryParams).toEqual({});
            expect(url).toBe('https://api.example.com/users');
        });
    });
});
