/**
 * @fileoverview Modal dialog component for renaming collections and endpoints
 * @module ui/RenameDialog
 */

import { BaseModal } from './BaseModal.js';

/**
 * Modal rename dialog with text input validation
 *
 * @class
 * @classdesc Provides a modal dialog for renaming items with keyboard support,
 * input validation, and auto-focus. Enter confirms; Escape and click-outside
 * (handled by {@link BaseModal}) cancel. Preserves special characters like
 * template variables.
 * @augments BaseModal
 */
export class RenameDialog extends BaseModal {
    /**
     * Creates a RenameDialog instance
     */
    constructor() {
        super();
        /** @type {Function|null} Pending promise resolver. */
        this.resolve = null;
    }

    /**
     * Shows the rename dialog and waits for user input.
     *
     * @param {string} currentName - The current name to pre-fill.
     * @param {Object} [options={}] - Dialog configuration options.
     * @param {string} [options.title='Rename Collection'] - Dialog title.
     * @param {string} [options.label='Collection Name:'] - Input field label.
     * @param {string} [options.confirmText='Rename'] - Confirm button label.
     * @returns {Promise<string|null>} Resolves to the new name (trimmed) or null if cancelled.
     */
    show(currentName, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog(currentName, options);
        });
    }

    /**
     * Builds and displays the rename dialog.
     *
     * @private
     * @param {string} currentName - Current name to pre-fill.
     * @param {Object} options - Dialog options.
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

        // Set value directly via .value property to preserve special characters like {{ }}
        const input = dialog.querySelector('#rename-input');
        if (input) {input.value = currentName;}

        this.setupEventListeners(dialog);
        this.focusInput(dialog);
    }

    /**
     * Attaches button and keyboard listeners specific to the rename flow.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element.
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
     * Focuses and selects text in the rename input.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element.
     * @returns {void}
     */
    focusInput(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        nameInput.focus();
        nameInput.select();
    }

    /**
     * Validates and resolves with the new name. No-op for empty names.
     *
     * @private
     * @param {string} newName - The entered name.
     * @returns {void}
     */
    confirm(newName) {
        const trimmedName = newName.trim();
        if (trimmedName) {
            this._settle(trimmedName);
        }
    }

    /**
     * Cancels the dialog (Escape / backdrop / cancel button), resolving with null.
     *
     * @protected
     * @returns {void}
     */
    onDismiss() {
        this._settle(null);
    }

    /**
     * Resolves the pending promise once and tears the dialog down.
     *
     * @private
     * @param {string|null} value - Value to resolve with.
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
