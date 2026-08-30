/* global document, KeyboardEvent, DOMParser */
import fs from 'fs';
import path from 'path';
import { ConfirmDialog } from '../../src/modules/ui/ConfirmDialog.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/dialogs/confirmDialog.html';

const pressEnter = (element) => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

describe('ConfirmDialog Enter key routing', () => {
    let dialog;

    beforeEach(() => {
        const html = fs.readFileSync(
            path.join(process.cwd(), 'src/templates/dialogs/confirmDialog.html'),
            'utf8'
        );
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
        document.body.innerHTML = '';
        dialog = new ConfirmDialog();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('Enter on the focused Cancel button cancels instead of confirming', async () => {
        const result = dialog.show('Delete everything?');

        pressEnter(document.getElementById('confirm-cancel-btn'));

        await expect(result).resolves.toBe(false);
    });

    test('Enter on the focused Confirm button confirms', async () => {
        const result = dialog.show('Delete everything?');

        pressEnter(document.getElementById('confirm-confirm-btn'));

        await expect(result).resolves.toBe(true);
    });

    test('the dialog opens with focus on Cancel', () => {
        dialog.show('Delete everything?');

        expect(document.activeElement).toBe(document.getElementById('confirm-cancel-btn'));
    });
});
