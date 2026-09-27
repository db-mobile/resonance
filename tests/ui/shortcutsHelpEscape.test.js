/* global document, DOMParser, KeyboardEvent */
import fs from 'fs';
import path from 'path';
import { keyboardShortcuts } from '../../src/modules/keyboardShortcuts.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE = './src/templates/shortcuts/keyboardShortcuts.html';

describe('keyboard shortcuts help dialog', () => {
    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/shortcuts/keyboardShortcuts.html'), 'utf8');
        templateLoader.cache.set(TEMPLATE, new DOMParser().parseFromString(html, 'text/html'));
        keyboardShortcuts.helpDialogVisible = false;
        document.body.innerHTML = '';
    });

    const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const overlays = () => document.querySelectorAll('#keyboard-shortcuts-dialog').length;

    test('closing with the button leaves no Escape handler behind to close the next dialog early', () => {
        keyboardShortcuts.showHelp();
        document.getElementById('close-shortcuts-btn').click();
        expect(overlays()).toBe(0);

        keyboardShortcuts.showHelp();
        expect(overlays()).toBe(1);
        pressEscape();

        expect(overlays()).toBe(0);
        expect(keyboardShortcuts.helpDialogVisible).toBe(false);

        pressEscape();
        keyboardShortcuts.showHelp();
        expect(overlays()).toBe(1);
        expect(keyboardShortcuts.helpDialogVisible).toBe(true);
    });
});
