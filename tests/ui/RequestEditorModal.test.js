/* global document, DOMParser, KeyboardEvent */
import fs from 'fs';
import path from 'path';
import { RequestEditorModal } from '../../src/modules/ui/runner/RequestEditorModal.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { pushEscapeHandler, escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

jest.mock('../../src/modules/scriptEditor.bundle.js', () => ({
    ScriptEditor: jest.fn().mockImplementation(() => ({
        setContent: jest.fn(),
        getContent: jest.fn(() => 'pm.test()'),
        destroy: jest.fn()
    }))
}), { virtual: true });

jest.mock('../../src/modules/jsonEditor.bundle.js', () => ({
    JSONEditor: jest.fn().mockImplementation(() => ({
        setContent: jest.fn(),
        getContent: jest.fn(() => ''),
        destroy: jest.fn()
    }))
}), { virtual: true });

const TEMPLATE_PATH = './src/templates/runner/runnerPanel.html';

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

const pressCtrlS = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));

const makeRequest = () => ({
    collectionId: 'c1',
    endpointId: 'e1',
    method: 'GET',
    path: '/users',
    overrides: null,
    postResponseScript: ''
});

describe('RequestEditorModal dialog behaviour', () => {
    let modal;

    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/runner/runnerPanel.html'), 'utf8');
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
        modal = new RequestEditorModal();
    });

    afterEach(() => {
        modal.close(false);
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    test('the dialog is labelled by its h2 title and marked modal', async () => {
        await modal.open(makeRequest());

        const dialog = document.querySelector('.modal-dialog--script-editor');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
        expect(title.tagName).toBe('H2');
        expect(title.classList.contains('dialog-title')).toBe(true);
        expect(document.querySelector('.modal-overlay--dim')).toBeNull();
    });

    test('closing restores focus to the element that opened it', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        await modal.open(makeRequest());
        document.querySelector('.modal-dialog--script-editor').focus();

        document.querySelector('[data-action="close"]').click();

        expect(document.querySelector('.modal-dialog--script-editor')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });

    test('a click on the overlay does not close the editor', async () => {
        await modal.open(makeRequest());

        document.querySelector('.runner-script-modal-overlay').click();

        expect(modal.modal).not.toBeNull();
        expect(document.querySelector('.modal-dialog--script-editor')).not.toBeNull();
    });

    test('Escape closes only the top-most dialog', async () => {
        const onSave = jest.fn();
        await modal.open(makeRequest(), { onSave });
        const top = jest.fn();
        const release = pushEscapeHandler(top);

        pressEscape();

        expect(top).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.modal-dialog--script-editor')).not.toBeNull();

        release();
        pressEscape();

        expect(document.querySelector('.modal-dialog--script-editor')).toBeNull();
        expect(onSave).not.toHaveBeenCalled();
    });

    test('Ctrl+S inside the editor saves and closes', async () => {
        const onSave = jest.fn();
        const request = makeRequest();
        await modal.open(request, { onSave });

        pressCtrlS(document.querySelector('.modal-dialog--script-editor [data-role="path-params-list"]'));

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(request.postResponseScript).toBe('pm.test()');
        expect(document.querySelector('.modal-dialog--script-editor')).toBeNull();
    });

    test('Ctrl+S outside the editor is ignored, also after it closed', async () => {
        const onSave = jest.fn();
        await modal.open(makeRequest(), { onSave });

        const outside = document.createElement('div');
        document.body.appendChild(outside);
        const event = pressCtrlS(outside);

        expect(event).toBe(true);
        expect(onSave).not.toHaveBeenCalled();

        modal.close(false);
        pressCtrlS(document);

        expect(onSave).not.toHaveBeenCalled();
    });
});
