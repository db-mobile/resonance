/* global document, DOMParser, KeyboardEvent */
import fs from 'fs';
import { RenameDialog } from '../../src/modules/ui/RenameDialog.js';
import { EditTagsDialog } from '../../src/modules/ui/EditTagsDialog.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

beforeAll(() => {
    for (const name of ['renameDialog', 'editTagsDialog']) {
        const path = `./src/templates/dialogs/${name}.html`;
        templateLoader.cache.set(path, new DOMParser().parseFromString(fs.readFileSync(path, 'utf8'), 'text/html'));
    }
});

afterEach(() => {
    expect(escapeHandlerCount()).toBe(0);
    document.body.innerHTML = '';
});

const cases = [
    { create: () => new RenameDialog(), prefix: 'rename', value: 'Before', text: ' After ', expected: 'After' },
    { create: () => new EditTagsDialog(), prefix: 'edit-tags', value: ['Before'], text: ' After,after , API ', expected: ['After', 'API'] }
];

describe.each(cases)('$prefix dialog', ({ create, prefix, value, text, expected }) => {
    test('focuses/selects input, applies labels and confirms with Enter', async () => {
        const dialog = create();
        const result = dialog.show(value, { title: 'Title', label: 'Label', confirmText: 'Accept' });
        const input = document.getElementById(`${prefix}-input`);
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(input.value.length);
        expect(dialog.dialog.querySelector('[data-role="title"]').textContent).toBe('Title');
        expect(dialog.dialog.querySelector('[data-role="label"]').textContent).toBe('Label');
        expect(dialog.dialog.querySelector('[data-role="confirm"]').textContent).toBe('Accept');

        input.value = text;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await expect(result).resolves.toEqual(expected);
        expect(dialog.dialog).toBeNull();
    });

    test.each(['cancel', 'close', 'escape', 'backdrop'])('%s resolves null and restores focus', async (action) => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const dialog = create();
        const result = dialog.show(value);
        if (action === 'escape') {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } else if (action === 'backdrop') {
            dialog.overlay.click();
        } else {
            document.getElementById(`${prefix}-${action}-btn`).click();
        }

        await expect(result).resolves.toBeNull();
        expect(document.activeElement).toBe(opener);
        dialog.onDismiss();
    });
});

test('a blank rename stays open until a valid name is confirmed', async () => {
    const dialog = new RenameDialog();
    const result = dialog.show('Before');
    const input = document.getElementById('rename-input');
    input.value = '  ';
    document.getElementById('rename-confirm-btn').click();
    expect(dialog.dialog).not.toBeNull();
    input.value = ' After ';
    document.getElementById('rename-confirm-btn').click();
    await expect(result).resolves.toBe('After');
});

test('clearing the tags confirms an empty list', async () => {
    const dialog = new EditTagsDialog();
    const result = dialog.show(['Before']);
    document.getElementById('edit-tags-input').value = '';
    document.getElementById('edit-tags-confirm-btn').click();
    await expect(result).resolves.toEqual([]);
});
