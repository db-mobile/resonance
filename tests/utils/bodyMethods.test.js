import { methodCarriesBody, requestSendsBody } from '../../src/modules/utils/bodyMethods.js';
import { generateCode } from '../../src/modules/codeGenerator.js';
import { captureRunnerEntry } from '../../src/modules/services/CoreExecutionService.js';

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
        const request = captureRunnerEntry({}, { collection: { id: 'c' }, endpoint: { id: 'e', method: 'DELETE' },
            persisted: { modifiedBody: '{"ids":[1]}' }, inheritedAuth: [], scripts: {} });
        expect(request.method).toBe('DELETE');
        expect(request.body.content).toBe('{"ids":[1]}');

    });
});
