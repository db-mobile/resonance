/**
 * @fileoverview Secret/reveal state for variable rows shared by the environment and collection variable dialogs
 * @module ui/secretToggle
 */

/**
 * @typedef {Object} SecretRowSelectors
 * @property {string} valueInput
 * @property {string} secretBtn
 * @property {string} revealBtn
 */

/**
 * @param {HTMLElement} row
 * @param {boolean} isSecret
 * @param {SecretRowSelectors} selectors
 * @returns {{valueInput: HTMLInputElement|null, secretBtn: HTMLElement|null, revealBtn: HTMLElement|null}}
 */
export function applySecretState(row, isSecret, selectors) {
    const valueInput = row.querySelector(selectors.valueInput);
    const secretBtn = row.querySelector(selectors.secretBtn);
    const revealBtn = row.querySelector(selectors.revealBtn);

    row.dataset.secret = isSecret ? 'true' : 'false';
    if (secretBtn) {secretBtn.classList.toggle('is-secret', isSecret);}
    if (revealBtn) {revealBtn.classList.toggle('is-hidden', !isSecret);}
    if (valueInput) {valueInput.type = isSecret ? 'password' : 'text';}
    if (revealBtn) {
        const icon = revealBtn.querySelector('.icon');
        if (icon) {
            icon.classList.add('icon-eye');
            icon.classList.remove('icon-eye-off');
        }
        revealBtn.title = 'Show value';
    }
    return { valueInput, secretBtn, revealBtn };
}

/**
 * @param {HTMLInputElement} valueInput
 * @param {HTMLElement} revealBtn
 * @returns {void}
 */
export function toggleRevealed(valueInput, revealBtn) {
    const showing = valueInput.type === 'text';
    valueInput.type = showing ? 'password' : 'text';
    const icon = revealBtn.querySelector('.icon');
    if (icon) {
        icon.classList.toggle('icon-eye', showing);
        icon.classList.toggle('icon-eye-off', !showing);
    }
    revealBtn.title = showing ? 'Show value' : 'Hide value';
}
