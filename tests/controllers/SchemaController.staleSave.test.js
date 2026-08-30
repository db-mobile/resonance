import { SchemaController } from '../../src/modules/controllers/SchemaController.js';

jest.mock('../../src/modules/editorLoader.js', () => ({
    createLazyEditorProxy: jest.fn()
}));

describe('SchemaController stale-context saves', () => {
    let controller;
    let repository;
    let editor;

    beforeEach(() => {
        jest.useFakeTimers();
        repository = {
            saveResponseSchema: jest.fn().mockResolvedValue(undefined),
            getResponseSchema: jest.fn().mockResolvedValue({ type: 'object' })
        };
        controller = new SchemaController({
            repository,
            statusDisplay: { update: jest.fn() }
        });
        editor = {
            getSchema: jest.fn(() => ({ marker: 'schema-A' })),
            setSchema: jest.fn(),
            isValidJson: jest.fn(() => true)
        };
        controller.editor = editor;
        controller._initialized = true;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('loadSchema flushes a pending save under the old endpoint before switching', async () => {
        controller.currentCollectionId = 'col-A';
        controller.currentEndpointId = 'ep-A';
        controller._handleSchemaChange('{}');

        await controller.loadSchema('col-B', 'ep-B');

        expect(repository.saveResponseSchema).toHaveBeenCalledTimes(1);
        expect(repository.saveResponseSchema).toHaveBeenCalledWith('col-A', 'ep-A', { marker: 'schema-A' });
        expect(editor.setSchema).toHaveBeenCalledWith({ type: 'object' }, { emitChange: false });
    });

    test('a save firing after the context changed still writes under the scheduled endpoint', async () => {
        controller.currentCollectionId = 'col-A';
        controller.currentEndpointId = 'ep-A';
        controller._handleSchemaChange('{}');

        controller.currentCollectionId = 'col-B';
        controller.currentEndpointId = 'ep-B';
        await jest.advanceTimersByTimeAsync(1000);

        expect(repository.saveResponseSchema).toHaveBeenCalledTimes(1);
        expect(repository.saveResponseSchema).toHaveBeenCalledWith('col-A', 'ep-A', expect.anything());
    });

    test('clearContext flushes the pending save before dropping the context', async () => {
        controller.currentCollectionId = 'col-A';
        controller.currentEndpointId = 'ep-A';
        controller._handleSchemaChange('{}');

        await controller.clearContext();

        expect(repository.saveResponseSchema).toHaveBeenCalledWith('col-A', 'ep-A', { marker: 'schema-A' });
        expect(controller.currentCollectionId).toBeNull();
        expect(editor.setSchema).toHaveBeenCalledWith(null, { emitChange: false });
    });

    test('no save is scheduled without an endpoint context', async () => {
        controller._handleSchemaChange('{}');

        await jest.advanceTimersByTimeAsync(1000);

        expect(repository.saveResponseSchema).not.toHaveBeenCalled();
    });
});
