/* global document */
import { applySecretState, toggleRevealed } from '../../src/modules/ui/secretToggle.js';

const SELECTORS = { valueInput: '.value', secretBtn: '.secret', revealBtn: '.reveal' };

function makeRow() {
    const row = document.createElement('div');
    row.innerHTML = '<input class="value" type="text">'
        + '<button class="secret"></button>'
        + '<button class="reveal is-hidden" title="Show value"><span class="icon icon-eye-off"></span></button>';
    return row;
}

describe('applySecretState', () => {
    test('marks the row secret, hides the value and resets the eye icon', () => {
        const row = makeRow();
        const result = applySecretState(row, true, SELECTORS);

        expect(row.dataset.secret).toBe('true');
        expect(row.querySelector('.secret').classList.contains('is-secret')).toBe(true);
        expect(row.querySelector('.reveal').classList.contains('is-hidden')).toBe(false);
        expect(row.querySelector('.value').type).toBe('password');
        const icon = row.querySelector('.icon');
        expect(icon.classList.contains('icon-eye')).toBe(true);
        expect(icon.classList.contains('icon-eye-off')).toBe(false);
        expect(row.querySelector('.reveal').title).toBe('Show value');
        expect(result.secretBtn).toBe(row.querySelector('.secret'));
    });

    test('clears the secret state', () => {
        const row = makeRow();
        applySecretState(row, true, SELECTORS);
        applySecretState(row, false, SELECTORS);

        expect(row.dataset.secret).toBe('false');
        expect(row.querySelector('.secret').classList.contains('is-secret')).toBe(false);
        expect(row.querySelector('.reveal').classList.contains('is-hidden')).toBe(true);
        expect(row.querySelector('.value').type).toBe('text');
    });

    test('tolerates rows without the optional controls', () => {
        const row = document.createElement('div');
        expect(() => applySecretState(row, true, SELECTORS)).not.toThrow();
        expect(row.dataset.secret).toBe('true');
    });
});

describe('toggleRevealed', () => {
    test('flips between password and text and swaps the icon', () => {
        const row = makeRow();
        applySecretState(row, true, SELECTORS);
        const valueInput = row.querySelector('.value');
        const revealBtn = row.querySelector('.reveal');

        toggleRevealed(valueInput, revealBtn);
        expect(valueInput.type).toBe('text');
        expect(revealBtn.querySelector('.icon').classList.contains('icon-eye-off')).toBe(true);
        expect(revealBtn.title).toBe('Hide value');

        toggleRevealed(valueInput, revealBtn);
        expect(valueInput.type).toBe('password');
        expect(revealBtn.querySelector('.icon').classList.contains('icon-eye')).toBe(true);
        expect(revealBtn.title).toBe('Show value');
    });
});
