import { methodCarriesBody, requestSendsBody } from '../../src/modules/utils/bodyMethods.js';
import { generateCode } from '../../src/modules/codeGenerator.js';
import { RunnerService } from '../../src/modules/services/RunnerService.js';

describe('methodCarriesBody', () => {
    test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'delete', 'PROPFIND'])('%s sends the body', (method) => {
        expect(methodCarriesBody(method)).toBe(true);
    });

    test.each(['GET', 'HEAD', 'get', undefined])('%s does not', (method) => {
        expect(methodCarriesBody(method)).toBe(false);
    });
});

describe('requestSendsBody', () => {
    test.each(['formdata', 'urlencoded', 'binary'])('a %s body is sent even with GET', (bodyMode) => {
        expect(requestSendsBody('GET', bodyMode)).toBe(true);
    });

    test('a json or text body follows the method', () => {
        expect(requestSendsBody('GET', 'json')).toBe(false);
        expect(requestSendsBody('HEAD', 'text')).toBe(false);
        expect(requestSendsBody('POST', 'json')).toBe(true);
    });
});

describe('DELETE requests keep their body', () => {
    test('in generated code', () => {
        const snippet = generateCode('curl', {
            method: 'DELETE',
            url: 'https://api.test/items',
            headers: { 'Content-Type': 'application/json' },
            body: '{"ids":[1,2]}'
        });
        expect(snippet).toContain('{"ids":[1,2]}');
    });

    test('in the collection runner', () => {
        const service = new RunnerService({}, {}, null);
        const { body } = service._buildBody({
            endpoint: { id: 'e1' },
            method: 'DELETE',
            isGraphQL: false,
            persisted: { modifiedBody: '{"ids":[1]}', formBodyData: null },
            overrides: {},
            variables: {}
        });
        expect(body).toEqual({ ids: [1] });
    });
});
