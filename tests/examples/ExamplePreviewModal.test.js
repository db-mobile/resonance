/* global document, DOMParser */
import { readFileSync } from 'node:fs';

jest.mock('../../src/modules/editorLoader.js', () => {
    const editor = { setContent: jest.fn(), destroy: jest.fn() };
    return { createLazyEditorProxy: jest.fn(() => editor), __editor: editor };
});

import { ExamplePreviewModal } from '../../src/modules/examples/ExamplePreviewModal.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { createLazyEditorProxy, __editor as editor } from '../../src/modules/editorLoader.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

beforeAll(() => {
    const path = './src/templates/examples/examplePreviewDialog.html';
    templateLoader.cache.set(path, new DOMParser().parseFromString(readFileSync('src/templates/examples/examplePreviewDialog.html', 'utf8'), 'text/html'));
});

afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
});

describe('ExamplePreviewModal', () => {
    test('shows status, content type, headers and the body in a read-only editor', () => {
        const modal = new ExamplePreviewModal();
        modal.show({
            name: 'Happy', status: 200, statusText: 'OK', contentType: 'application/json',
            headers: [{ key: 'x-a', value: '1' }], body: '{"a":1}'
        });

        expect(modal.dialog.querySelector('[data-role="title"]').textContent).toBe('Happy');
        expect(modal.dialog.querySelector('.example-preview-status').textContent).toBe('200 OK');
        expect(modal.dialog.querySelector('.example-preview-status').classList.contains('status-success')).toBe(true);
        expect(modal.dialog.querySelector('.example-preview-content-type').textContent).toBe('application/json');
        expect([...modal.dialog.querySelectorAll('.example-preview-headers .row')].map((r) => [r.querySelector('.title').textContent, r.querySelector('.subtitle').textContent])).toEqual([['x-a', '1']]);
        expect(createLazyEditorProxy).toHaveBeenCalledWith('response', modal.dialog.querySelector('.example-preview-editor'));
        expect(editor.setContent).toHaveBeenCalledWith('{"a":1}', 'application/json');

        modal.dialog.querySelector('#example-preview-close-btn').click();
        expect(modal.dialog).toBeNull();
        expect(editor.destroy).toHaveBeenCalled();
        expect(escapeHandlerCount()).toBe(0);
    });

    test('binary bodies show a size note instead of an editor and empty headers are hidden', () => {
        const modal = new ExamplePreviewModal();
        modal.show({ name: 'Img', status: 200, headers: [], body: 'AAAA', bodyEncoding: 'base64' });

        expect(modal.dialog.querySelector('.example-preview-binary').textContent).toBe('Binary body (3 bytes, base64)');
        expect(modal.dialog.querySelector('.example-preview-editor').classList.contains('is-hidden')).toBe(true);
        expect(modal.dialog.querySelector('.example-preview-headers').classList.contains('is-hidden')).toBe(true);
        expect(createLazyEditorProxy).not.toHaveBeenCalled();
        modal.destroy();
    });
});
