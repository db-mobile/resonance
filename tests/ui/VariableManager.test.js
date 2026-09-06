/* global document, DOMParser */
/** @fileoverview Characterization tests for the collection-variable dialog. */

import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { VariableManager } from '../../src/modules/ui/VariableManager.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const TEMPLATE_PATH = './src/templates/variables/variableManager.html';

function seedTemplates() {
    const html = fs.readFileSync(
        path.resolve('src/templates/variables/variableManager.html'),
        'utf8'
    );
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

function rows() {
    return Array.from(document.querySelectorAll('.variable-row'));
}

function fillRow(row, name, value) {
    row.querySelector('.variable-name').value = name;
    row.querySelector('.variable-value').value = value;
}

function click(id) {
    document.getElementById(id).click();
}

describe('VariableManager', () => {
    beforeEach(seedTemplates);

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('renders one row per variable, plus a trailing blank row', async () => {
        const manager = new VariableManager();
        manager.show('My Collection', [
            { name: 'token', value: 'abc', secret: true },
            { name: 'host', value: 'example.com' }
        ]);

        const names = rows().map(r => r.querySelector('.variable-name').value);
        expect(names).toEqual(['token', 'host', '']);

        click('variables-cancel-btn');
    });

    test('shows the collection name in the title', () => {
        const manager = new VariableManager();
        manager.show('My Collection', []);

        expect(document.querySelector('[data-role="title"]').textContent)
            .toBe('Variables - My Collection');

        click('variables-cancel-btn');
    });

    test('accepts a legacy flat object of variables', () => {
        const manager = new VariableManager();
        manager.show('C', { host: 'example.com' });

        expect(rows()[0].querySelector('.variable-name').value).toBe('host');

        click('variables-cancel-btn');
    });

    test('resolves with the edited variables and the secret names', async () => {
        const manager = new VariableManager();
        const result = manager.show('C', [{ name: 'token', value: 'abc', secret: true }]);

        fillRow(rows()[1], 'host', 'example.com');
        click('variables-save-btn');

        await expect(result).resolves.toEqual({
            variables: { token: 'abc', host: 'example.com' },
            secretKeys: ['token']
        });
    });

    test('resolves with null when cancelled', async () => {
        const manager = new VariableManager();
        const result = manager.show('C', []);

        click('variables-cancel-btn');

        await expect(result).resolves.toBeNull();
    });

    test('rejects an invalid variable name without resolving', async () => {
        const manager = new VariableManager();
        let settled = false;
        manager.show('C', []).then(() => { settled = true; });

        fillRow(rows()[0], 'not a name', 'v');
        click('variables-save-btn');

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(document.querySelector('#variables-container')).not.toBeNull();

        click('variables-cancel-btn');
    });

    test('rejects a duplicate variable name', async () => {
        const manager = new VariableManager();
        let settled = false;
        manager.show('C', []).then(() => { settled = true; });

        click('add-variable-btn');
        fillRow(rows()[0], 'dup', 'a');
        fillRow(rows()[1], 'dup', 'b');
        click('variables-save-btn');

        await Promise.resolve();
        expect(settled).toBe(false);

        click('variables-cancel-btn');
    });

    test('removes the dialog from the document on save and on cancel', async () => {
        const saved = new VariableManager();
        const savedResult = saved.show('C', []);
        click('variables-save-btn');
        await savedResult;
        expect(document.querySelector('#variables-container')).toBeNull();

        seedTemplates();
        const cancelled = new VariableManager();
        const cancelledResult = cancelled.show('C', []);
        click('variables-cancel-btn');
        await cancelledResult;
        expect(document.querySelector('#variables-container')).toBeNull();
    });

    test('releases its Escape registration on every close path', async () => {
        const before = escapeHandlerCount();

        const manager = new VariableManager();
        const result = manager.show('C', []);
        expect(escapeHandlerCount()).toBe(before + 1);

        click('variables-cancel-btn');
        await result;

        expect(escapeHandlerCount()).toBe(before);
    });
});
