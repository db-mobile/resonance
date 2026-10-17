import { SchemaController } from '../../src/modules/controllers/SchemaController.js';

jest.mock('../../src/modules/editorLoader.js', () => ({
    createLazyEditorProxy: jest.fn()
}));

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

describe('SchemaController response validation', () => {
    let controller;
    let repository;
    let backendAPI;
    let editor;
    let content;
    let status;

    beforeEach(() => {
        jest.useFakeTimers();
        globalThis.document.body.innerHTML = '<div id="schema-validation-status"></div>';
        status = globalThis.document.getElementById('schema-validation-status');
        content = '{"type":"object"}';
        repository = {
            saveResponseSchema: jest.fn().mockResolvedValue(undefined),
            getResponseSchema: jest.fn().mockResolvedValue({ type: 'number' })
        };
        backendAPI = {
            schema: {
                check: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
                validate: jest.fn().mockResolvedValue({ valid: true, schemaValid: true, errors: [] })
            }
        };
        editor = {
            getContent: () => content,
            getSchema: () => {
                try { return JSON.parse(content); } catch { return null; }
            },
            isValidJson: () => {
                try { JSON.parse(content); return true; } catch { return !content.trim(); }
            },
            setSchema: jest.fn((schema) => {
                content = schema === null || schema === undefined ? '' : JSON.stringify(schema);
            }),
            __ready: Promise.resolve(),
            destroy: jest.fn()
        };
        controller = new SchemaController({
            repository,
            statusDisplay: { update: jest.fn() },
            backendAPI
        });
        controller.editor = editor;
        controller._initialized = true;
        controller.currentCollectionId = 'collection-A';
        controller.currentEndpointId = 'endpoint-A';
    });

    afterEach(() => {
        controller.destroy();
        jest.useRealTimers();
        globalThis.document.body.innerHTML = '';
    });

    test('checks schema structure before displaying success', async () => {
        content = '{"type":"not-a-json-schema-type"}';
        backendAPI.schema.check.mockResolvedValue({
            valid: false,
            errors: [{ path: '/type', message: 'Unknown type', keyword: 'enum' }]
        });

        await controller._updateValidationStatus();

        expect(backendAPI.schema.check).toHaveBeenCalledWith({ type: 'not-a-json-schema-type' });
        expect(status.className).toContain('is-error');
        expect(status.textContent).not.toBe('Valid JSON Schema');
    });

    test('invalid JSON is visible and is not sent to the schema checker', async () => {
        content = '{"type":';

        await controller._updateValidationStatus();

        expect(status.className).toContain('is-error');
        expect(status.textContent).toMatch(/JSON/);
        expect(backendAPI.schema.check).not.toHaveBeenCalled();
    });

    test.each([false, true, {}])('treats %j as an actual schema', async (schema) => {
        content = JSON.stringify(schema);
        const isValid = schema !== false;
        backendAPI.schema.validate.mockResolvedValue({
            valid: isValid,
            schemaValid: true,
            errors: isValid ? [] : [{ path: '/', message: 'False schema', keyword: 'false' }]
        });

        await controller._updateValidationStatus();
        const result = await controller.validateResponse({ example: 1 });
        await controller._saveSchema('collection-A', 'endpoint-A');

        expect(status.textContent).toBe('Valid JSON Schema');
        expect(backendAPI.schema.check).toHaveBeenCalledWith(schema);
        expect(backendAPI.schema.validate).toHaveBeenCalledWith(schema, { example: 1 });
        expect(result).toMatchObject({ valid: isValid, schemaValid: true, hasSchema: true });
        expect(repository.saveResponseSchema).toHaveBeenCalledWith('collection-A', 'endpoint-A', schema);
    });

    test('only empty content means that there is no schema', async () => {
        content = '  \n  ';

        const result = await controller.validateResponse({ anything: true });

        expect(result).toMatchObject({ valid: true, hasSchema: false, errors: [] });
        expect(backendAPI.schema.validate).not.toHaveBeenCalled();
    });

    test('literal null is an invalid schema instead of disabling validation', async () => {
        content = 'null';
        backendAPI.schema.check.mockResolvedValue({
            valid: false,
            errors: [{ path: '/', message: 'Schema must be an object or boolean', keyword: 'type' }]
        });
        backendAPI.schema.validate.mockResolvedValue({
            valid: false,
            schemaValid: false,
            errors: [{ path: '/', message: 'Schema must be an object or boolean', keyword: 'type' }]
        });

        await controller._updateValidationStatus();
        const result = await controller.validateResponse({});

        expect(status.className).toContain('is-error');
        expect(result).toMatchObject({ valid: false, schemaValid: false, hasSchema: true });
    });

    test('reports malformed schema JSON during response validation', async () => {
        content = '{"type":';

        const result = await controller.validateResponse({});

        expect(result).toMatchObject({ valid: false, schemaValid: false, hasSchema: true });
        expect(result.errors.length).toBeGreaterThan(0);
        expect(backendAPI.schema.validate).not.toHaveBeenCalled();
    });

    test('reports backend failures without showing a successful schema', async () => {
        backendAPI.schema.check.mockRejectedValue(new Error('Validation engine unavailable'));
        backendAPI.schema.validate.mockRejectedValue(new Error('Validation engine unavailable'));

        await controller._updateValidationStatus();
        const result = await controller.validateResponse({});

        expect(status.className).toContain('is-error');
        expect(status.textContent).not.toBe('Valid JSON Schema');
        expect(result).toMatchObject({ valid: false, hasSchema: true });
        expect(result.errors.length).toBeGreaterThan(0);
    });

    test('shows an error when the backend API is missing', async () => {
        controller.destroy();
        controller = new SchemaController({ repository, statusDisplay: { update: jest.fn() } });
        controller.editor = editor;

        await controller._updateValidationStatus();

        expect(status.className).toContain('is-error');
        expect(status.textContent).not.toBe('Valid JSON Schema');
    });

    test('keeps the request schema snapshot after the active editor changes', async () => {
        content = '{"const":"original"}';
        const snapshot = controller.captureSchema();
        content = '{"const":"another-tab"}';
        controller.currentEndpointId = 'endpoint-B';

        // The native HTTP transport already decoded the JSON response body.
        const result = await controller.validateResponse('original', snapshot);

        expect(backendAPI.schema.validate).toHaveBeenCalledWith({ const: 'original' }, 'original');
        expect(result).toMatchObject({ valid: true, hasSchema: true });
    });

    test.each(['hello', '123', 'false', '{"key":1}'])('does not parse an already decoded JSON string %j again', async (body) => {
        content = '{"type":"string"}';

        await controller.validateResponse(body);

        expect(backendAPI.schema.validate).toHaveBeenCalledWith({ type: 'string' }, body);
    });

    test('infers string type for an already decoded numeric JSON string', () => {
        controller.setLastResponseBody('123');

        controller.inferSchemaFromResponse();

        expect(editor.setSchema).toHaveBeenCalledWith({ type: 'string' });
    });

    test('rejects malformed JSON transport data without treating it as a JSON string', async () => {
        content = '{"type":"string"}';

        const result = await controller.validateResponse('{broken', controller.captureSchema(), { isJson: false });

        expect(result).toMatchObject({ valid: false, hasSchema: true, errors: [{ keyword: 'parse' }] });
        expect(backendAPI.schema.validate).not.toHaveBeenCalled();
    });

    test('ignores a check result when content changed before the debounced change callback', async () => {
        const pending = deferred();
        backendAPI.schema.check.mockReturnValueOnce(pending.promise);
        const check = controller._updateValidationStatus();
        content = '{"type":"string"}';
        const statusBeforeCompletion = status.textContent;

        pending.resolve({ valid: false, errors: [{ message: 'Obsolete error' }] });
        await check;

        expect(status.textContent).toBe(statusBeforeCompletion);
        expect(status.textContent).not.toContain('Obsolete error');
    });

    test.each(['loadSchema', 'clearContext', 'destroy'])('ignores a check result after %s', async (operation) => {
        const pending = deferred();
        backendAPI.schema.check.mockReturnValueOnce(pending.promise);
        const check = controller._updateValidationStatus();

        if (operation === 'loadSchema') {
            await controller.loadSchema('collection-B', 'endpoint-B');
        } else {
            await controller[operation]();
        }
        // Allow a new context's own schema check to finish independently.
        await Promise.resolve();
        const statusBeforeCompletion = status.textContent;
        pending.resolve({ valid: false, errors: [{ message: 'Obsolete error' }] });
        await check;

        expect(status.textContent).toBe(statusBeforeCompletion);
        expect(status.textContent).not.toContain('Obsolete error');
    });

    test('does not replace a saved schema with null while the user types invalid JSON', async () => {
        content = '{"type":';
        controller._handleSchemaChange(content);

        await controller.flushPendingSave();

        expect(repository.saveResponseSchema).not.toHaveBeenCalled();
    });

    test.each([
        [false, 'boolean'],
        [0, 'integer']
    ])('infers a schema from the valid falsy response %j', (response, type) => {
        controller.setLastResponseBody(response);

        controller.inferSchemaFromResponse();

        expect(editor.setSchema).toHaveBeenCalledWith(expect.objectContaining({ type }));
    });
});
