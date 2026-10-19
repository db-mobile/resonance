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

    describe('processRequestComponents with query rows', () => {
        it('preserves duplicate keys in the query string and URL', () => {
            const queryParams = { id: '2' };
            const result = service.processRequestComponents({
                url: 'https://api.example.com/items',
                pathParams: {},
                headers: {},
                queryParams,
                queryRows: [
                    { key: 'id', value: '1' },
                    { key: 'id', value: '2' }
                ],
                variables: {},
                processor
            });

            expect(result.queryString).toBe('id=1&id=2');
            expect(result.url).toBe('https://api.example.com/items?id=1&id=2');
        });

        it('templates row keys and values with the shared processor', () => {
            const result = service.processRequestComponents({
                url: 'https://api.example.com/items',
                pathParams: {},
                headers: {},
                queryParams: {},
                queryRows: [{ key: 'token', value: '{{apiToken}}' }],
                variables: { apiToken: 's3cret value' },
                processor
            });

            expect(result.queryString).toBe('token=s3cret%20value');
        });

        it('drops rows whose key resolves empty', () => {
            const result = service.processRequestComponents({
                url: 'https://api.example.com/items',
                pathParams: {},
                headers: {},
                queryParams: {},
                queryRows: [{ key: '', value: 'x' }, { key: 'a', value: '1' }],
                variables: {},
                processor
            });

            expect(result.queryString).toBe('a=1');
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

});
