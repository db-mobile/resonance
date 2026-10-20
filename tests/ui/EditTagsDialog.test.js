/* global document, DOMParser, KeyboardEvent */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { EditTagsDialog } from '../../src/modules/ui/EditTagsDialog.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const TEMPLATE = './src/templates/dialogs/editTagsDialog.html';

beforeAll(() => {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/dialogs/editTagsDialog.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE, new DOMParser().parseFromString(html, 'text/html'));
});

afterEach(() => { document.body.innerHTML = ''; });

const input = () => document.querySelector('#edit-tags-input');

describe('EditTagsDialog', () => {
    test('shows the current tags and resolves the parsed, normalized list on confirm', async () => {
        const dialog = new EditTagsDialog();
        const result = dialog.show(['smoke', 'Pets'], { title: 'Edit Tags', label: 'Tags:', confirmText: 'Save' });

        expect(input().value).toBe('smoke, Pets');
        expect(document.querySelector('[data-role="title"]').textContent).toBe('Edit Tags');
        input().value = ' auth ,smoke, AUTH ,';
        document.querySelector('#edit-tags-confirm-btn').click();

        await expect(result).resolves.toEqual(['auth', 'smoke']);
        expect(input()).toBeNull();
    });

    test('Enter confirms and an empty entry resolves an empty list', async () => {
        const dialog = new EditTagsDialog();
        const result = dialog.show(['smoke']);

        input().value = '';
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await expect(result).resolves.toEqual([]);
    });

    test('cancel resolves null and releases the escape handler', async () => {
        const before = escapeHandlerCount();
        const dialog = new EditTagsDialog();
        const result = dialog.show([]);

        document.querySelector('#edit-tags-cancel-btn').click();

        await expect(result).resolves.toBeNull();
        expect(escapeHandlerCount()).toBe(before);
    });
});
