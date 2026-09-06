/**
 * @fileoverview Modal dialog component for renaming collections and endpoints
 * @module ui/RenameDialog
 */

import { BaseModal } from './BaseModal.js';

/** @augments */
export class RenameDialog extends BaseModal {
    constructor() {
        super();
        /** @type {Function|null} */
        this.resolve = null;
    }

    /**
     * @param {string} currentName
     * @param {Object} [options={}]
     * @param {string} [options.title='Rename Collection']
     * @param {string} [options.label='Collection Name:']
     * @param {string} [options.confirmText='Rename']
     * @returns {Promise<string|null>}
     */
    show(currentName, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog(currentName, options);
        });
    }

    /**
     * @param {string} currentName
     * @param {Object} options
     * @returns {void}
     */
    createDialog(currentName, options) {
        const dialog = this.mount({
            overlayClass: 'rename-dialog-overlay',
            dialogClass: 'rename-dialog modal-dialog modal-dialog--sm',
            templatePath: './src/templates/dialogs/renameDialog.html',
            templateId: 'tpl-rename-dialog'
        });

        const titleEl = dialog.querySelector('[data-role="title"]');
        const labelEl = dialog.querySelector('[data-role="label"]');
        const confirmEl = dialog.querySelector('[data-role="confirm"]');

        if (titleEl) {titleEl.textContent = options.title || 'Rename Collection';}
        if (labelEl) {labelEl.textContent = options.label || 'Collection Name:';}
        if (confirmEl) {confirmEl.textContent = options.confirmText || 'Rename';}

        const input = dialog.querySelector('#rename-input');
        if (input) {input.value = currentName;}

        this.setupEventListeners(dialog);
        this.focusInput(dialog);
    }

    /**
     * @param {HTMLElement} dialog
     * @returns {void}
     */
    setupEventListeners(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        const cancelBtn = dialog.querySelector('#rename-cancel-btn');
        const confirmBtn = dialog.querySelector('#rename-confirm-btn');

        cancelBtn.addEventListener('click', () => this.onDismiss());
        confirmBtn.addEventListener('click', () => this.confirm(nameInput.value));

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirm(nameInput.value);
            }
        });
    }

    /**
     * @param {HTMLElement} dialog
     * @returns {void}
     */
    focusInput(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        nameInput.focus();
        nameInput.select();
    }

    /**
     * @param {string} newName
     * @returns {void}
     */
    confirm(newName) {
        const trimmedName = newName.trim();
        if (trimmedName) {
            this._settle(trimmedName);
        }
    }

    /** @returns {void} */
    onDismiss() {
        this._settle(null);
    }

    /**
     * @param {string|null} value
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
