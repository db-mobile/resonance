import { methodCarriesBody, requestSendsBody } from '../../src/modules/utils/bodyMethods.js';
import { generateCode } from '../../src/modules/codeGenerator.js';
import { captureRunnerEntry } from '../../src/modules/services/CoreExecutionService.js';

describe('methodCarriesBody', () => {
    test.each(['GET', 'get', undefined, 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'delete', 'PROPFIND'])('%s sends the body', (method) => {
        expect(methodCarriesBody(method)).toBe(true);
    });

    test.each(['HEAD', 'head'])('%s does not', (method) => {
        expect(methodCarriesBody(method)).toBe(false);
    });
});

describe('requestSendsBody', () => {
    test.each(['formdata', 'urlencoded', 'binary'])('a %s body is sent even with GET', (bodyMode) => {
        expect(requestSendsBody('GET', bodyMode)).toBe(true);
    });

    test('GET sends JSON and text while HEAD remains unchanged', () => {
        expect(requestSendsBody('GET', 'json')).toBe(true);
        expect(requestSendsBody('GET', 'text')).toBe(true);
        expect(requestSendsBody('HEAD', 'text')).toBe(false);
        expect(requestSendsBody('POST', 'json')).toBe(true);
    });
});

describe.each(['GET', 'DELETE'])('%s requests keep their body', (method) => {
    test('in generated code', () => {
        const snippet = generateCode('curl', {
            method,
            url: 'https://api.test/items',
            headers: { 'Content-Type': 'application/json' },
            body: '{"ids":[1,2]}'
        });
        expect(snippet).toContain('{"ids":[1,2]}');
    });

    test('in the collection runner', () => {
        const request = captureRunnerEntry({}, { collection: { id: 'c' }, endpoint: { id: 'e', method },
            persisted: { modifiedBody: '{"ids":[1]}' }, inheritedAuth: [], scripts: {} });
        expect(request.method).toBe(method);
        expect(request.body.content).toBe('{"ids":[1]}');

    });
});
