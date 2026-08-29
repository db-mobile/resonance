import { captureSnippetBody } from '../src/modules/requestBodyHelper.js';
import { VariableProcessor } from '../src/modules/variables/VariableProcessor.js';

describe('captureSnippetBody', () => {
    let processor;
    const variables = { host: 'example.com', token: 's3cret' };

    beforeEach(() => {
        processor = new VariableProcessor();
    });

    test('formdata mode returns templated enabled rows with bodyType', () => {
        const formBodyManager = {
            getFormDataRows: () => [
                { key: 'user', value: '{{token}}', type: 'text', enabled: true },
                { key: 'skip', value: 'x', type: 'text', enabled: false },
                { key: 'upload', value: '', type: 'file', filePath: '/tmp/{{host}}.bin', contentType: 'application/octet-stream' }
            ]
        };

        const result = captureSnippetBody({
            bodyMode: 'formdata', formBodyManager, requestBodyTextEditor: null,
            jsonContent: '', processor, variables
        });

        expect(result.bodyType).toBe('formdata');
        expect(result.body).toEqual([
            { key: 'user', value: 's3cret', type: 'text', filePath: undefined, contentType: undefined },
            { key: 'upload', value: '', type: 'file', filePath: '/tmp/example.com.bin', contentType: 'application/octet-stream' }
        ]);
    });

    test('urlencoded mode uses the urlencoded rows', () => {
        const formBodyManager = {
            getUrlencodedRows: () => [{ key: 'q', value: '{{host}}', type: 'text', enabled: true }]
        };

        const result = captureSnippetBody({
            bodyMode: 'urlencoded', formBodyManager, requestBodyTextEditor: null,
            jsonContent: '', processor, variables
        });

        expect(result.bodyType).toBe('urlencoded');
        expect(result.body[0]).toMatchObject({ key: 'q', value: 'example.com' });
    });

    test('binary mode returns the templated file descriptor', () => {
        const formBodyManager = {
            getBinaryBody: () => ({ filePath: '/data/{{host}}.pdf', contentType: 'application/pdf' })
        };

        const result = captureSnippetBody({
            bodyMode: 'binary', formBodyManager, requestBodyTextEditor: null,
            jsonContent: '', processor, variables
        });

        expect(result).toEqual({
            body: { filePath: '/data/example.com.pdf', contentType: 'application/pdf' },
            bodyType: 'binary'
        });
    });

    test('binary mode without a selected file omits the body', () => {
        const formBodyManager = { getBinaryBody: () => ({ filePath: '', contentType: '' }) };

        const result = captureSnippetBody({
            bodyMode: 'binary', formBodyManager, requestBodyTextEditor: null,
            jsonContent: '', processor, variables
        });

        expect(result).toEqual({});
    });

    test('text mode returns the templated raw string', () => {
        const requestBodyTextEditor = { getContent: () => 'host is {{host}}' };

        const result = captureSnippetBody({
            bodyMode: 'text', formBodyManager: null, requestBodyTextEditor,
            jsonContent: '', processor, variables
        });

        expect(result).toEqual({ body: 'host is example.com', bodyType: 'text' });
    });

    test('json mode parses templated content without a bodyType', () => {
        const result = captureSnippetBody({
            bodyMode: 'json', formBodyManager: null, requestBodyTextEditor: null,
            jsonContent: '{"token": "{{token}}"}', processor, variables
        });

        expect(result).toEqual({ body: { token: 's3cret' } });
    });

    test('json mode reports parse failures as an error', () => {
        const result = captureSnippetBody({
            bodyMode: 'json', formBodyManager: null, requestBodyTextEditor: null,
            jsonContent: 'not json', processor, variables
        });

        expect(result.error).toBeTruthy();
        expect(result.body).toBeUndefined();
    });
});
