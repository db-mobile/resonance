/**
 * @fileoverview Modal dialog for editing a request's tags as a comma-separated list
 * @module ui/EditTagsDialog
 */

import { BaseModal } from './BaseModal.js';
import { parseTagInput, formatTagInput } from '../utils/requestTags.js';

/** @augments */
export class EditTagsDialog extends BaseModal {
    constructor() {
        super();
        /** @type {Function|null} */
        this.resolve = null;
    }

    /**
     * @param {Array<string>} currentTags
     * @param {Object} [options={}]
     * @param {string} [options.title='Edit Tags']
     * @param {string} [options.label='Tags (comma-separated):']
     * @param {string} [options.confirmText='Save']
     * @returns {Promise<Array<string>|null>}
     */
    show(currentTags, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog(currentTags, options);
        });
    }

    /**
     * @param {Array<string>} currentTags
     * @param {Object} options
     * @returns {void}
     */
    createDialog(currentTags, options) {
        const dialog = this.mount({
            overlayClass: 'edit-tags-dialog-overlay',
            dialogClass: 'edit-tags-dialog modal-dialog modal-dialog--sm',
            templatePath: './src/templates/dialogs/editTagsDialog.html',
            templateId: 'tpl-edit-tags-dialog'
        });

        const titleEl = dialog.querySelector('[data-role="title"]');
        const labelEl = dialog.querySelector('[data-role="label"]');
        const confirmEl = dialog.querySelector('[data-role="confirm"]');

        if (titleEl) {titleEl.textContent = options.title || 'Edit Tags';}
        if (labelEl) {labelEl.textContent = options.label || 'Tags (comma-separated):';}
        if (confirmEl) {confirmEl.textContent = options.confirmText || 'Save';}

        const input = dialog.querySelector('#edit-tags-input');
        if (input) {input.value = formatTagInput(currentTags);}

        this.setupEventListeners(dialog);
        this.focusInput(dialog);
    }

    /**
     * @param {HTMLElement} dialog
     * @returns {void}
     */
    setupEventListeners(dialog) {
        const input = dialog.querySelector('#edit-tags-input');
        const cancelBtn = dialog.querySelector('#edit-tags-cancel-btn');
        const confirmBtn = dialog.querySelector('#edit-tags-confirm-btn');

        cancelBtn.addEventListener('click', () => this.onDismiss());
        dialog.querySelector('#edit-tags-close-btn')?.addEventListener('click', () => this.onDismiss());
        confirmBtn.addEventListener('click', () => this.confirm(input.value));

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirm(input.value);
            }
        });
    }

    /**
     * @param {HTMLElement} dialog
     * @returns {void}
     */
    focusInput(dialog) {
        const input = dialog.querySelector('#edit-tags-input');
        input.focus();
        input.select();
    }

    /**
     * @param {string} text
     * @returns {void}
     */
    confirm(text) {
        this._settle(parseTagInput(text));
    }

    /** @returns {void} */
    onDismiss() {
        this._settle(null);
    }

    /**
     * @param {Array<string>|null} value
     * @returns {void}
     */
    _settle(value) {
        if (this.resolve) {
            this.resolve(value);
            this.resolve = null;
        }
        this.destroy();
    }
}
