/* global document */
jest.mock('../../src/modules/ui/Toast.js', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/modules/ui/ExampleNameDialog.js', () => {
    const show = jest.fn();
    return { ExampleNameDialog: jest.fn(() => ({ show })), __show: show };
});

import { app } from '../../src/modules/appContext.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { __show as show } from '../../src/modules/ui/ExampleNameDialog.js';
import { attachSaveExampleHandler, handleSaveExample } from '../../src/modules/examples/exampleCapture.js';

function boundTab() {
    return {
        id: 't1',
        endpoint: { collectionId: 'c1', endpointId: 'e1' },
        request: { protocol: 'http' },
        response: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, data: { ok: true }, isJson: true }
    };
}

describe('handleSaveExample', () => {
    let button;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        button = document.createElement('button');
        app.workspaceTabController = { service: { getAllTabs: jest.fn().mockResolvedValue([boundTab()]) } };
        app.examplesService = {
            getExamples: jest.fn().mockResolvedValue([{ id: 'old', name: '200 OK' }]),
            addExample: jest.fn().mockResolvedValue([])
        };
        show.mockResolvedValue('My example');
    });

    afterEach(() => {
        delete app.workspaceTabController;
        delete app.examplesService;
        jest.useRealTimers();
    });

    test('prompts with a unique suggested name, saves and confirms', async () => {
        const saved = await handleSaveExample(button, 't1');

        expect(show).toHaveBeenCalledWith('200 OK (2)', expect.objectContaining({ title: 'Save as example', confirmText: 'Save' }));
        expect(app.examplesService.addExample).toHaveBeenCalledWith('c1', 'e1', expect.objectContaining({
            name: 'My example', status: 200, body: '{\n  "ok": true\n}', contentType: 'application/json'
        }));
        expect(saved.name).toBe('My example');
        expect(toast.success).toHaveBeenCalledWith('Example "My example" saved');
        expect(button.classList.contains('copied')).toBe(true);
        jest.advanceTimersByTime(2000);
        expect(button.classList.contains('copied')).toBe(false);
    });

    test('makes a typed name unique against existing examples', async () => {
        show.mockResolvedValue('200 OK');

        await handleSaveExample(button, 't1');

        expect(app.examplesService.addExample).toHaveBeenCalledWith('c1', 'e1', expect.objectContaining({ name: '200 OK (2)' }));
    });

    test('a cancelled dialog saves nothing', async () => {
        show.mockResolvedValue(null);

        expect(await handleSaveExample(button, 't1')).toBeNull();
        expect(app.examplesService.addExample).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('refusals explain why and never open the dialog', async () => {
        app.workspaceTabController.service.getAllTabs.mockResolvedValue([{ ...boundTab(), endpoint: null }]);

        expect(await handleSaveExample(button, 't1')).toBeNull();

        expect(toast.error).toHaveBeenCalledWith('Save the request to a collection before adding examples');
        expect(show).not.toHaveBeenCalled();
        app.workspaceTabController.service.getAllTabs.mockResolvedValue([]);
        await handleSaveExample(button, 't1');
        expect(toast.error).toHaveBeenLastCalledWith('Save the request to a collection before adding examples');
    });

    test('a failed write reports the error and flags the button', async () => {
        app.examplesService.addExample.mockRejectedValue(new Error('read-only'));

        expect(await handleSaveExample(button, 't1')).toBeNull();

        expect(toast.error).toHaveBeenCalledWith('Failed to save example: read-only');
        expect(button.classList.contains('copy-error')).toBe(true);
    });

    test('attachSaveExampleHandler wires the click and tolerates a missing button', async () => {
        attachSaveExampleHandler(null, 't1');
        attachSaveExampleHandler(button, 't1');

        button.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(show).toHaveBeenCalled();
    });
});
