/**
 * @fileoverview Modal confirmation dialog component for user confirmations
 * @module ui/ConfirmDialog
 */

import { BaseModal } from './BaseModal.js';

/**
 * Modal dialog component for confirmation prompts
 *
 * @class
 * @classdesc Provides a customizable confirmation dialog with promise-based API.
 * Supports keyboard navigation (Enter confirms, Tab cycles buttons; Escape and
 * click-outside cancel via {@link BaseModal}), dangerous action styling, and focus
 * management for accessibility.
 * @augments BaseModal
 */
export class ConfirmDialog extends BaseModal {
    /**
     * Creates a ConfirmDialog instance
     */
    constructor() {
        super();
        /** @type {Function|null} Pending promise resolver. */
        this.resolve = null;
    }

    /**
     * Shows the confirmation dialog and waits for user response.
     *
     * @param {string} message - The confirmation message to display.
     * @param {Object} [options={}] - Dialog configuration options.
     * @param {string} [options.title='Confirm Action'] - Dialog title.
     * @param {string} [options.confirmText='Confirm'] - Confirm button label.
     * @param {string} [options.cancelText='Cancel'] - Cancel button label.
     * @param {boolean} [options.dangerous=true] - Style confirm as a dangerous action (red button).
     * @returns {Promise<boolean>} Resolves to true if confirmed, false if cancelled.
     */
    show(message, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog(message, options);
        });
    }

    /**
     * Builds and displays the confirmation dialog.
     *
     * @private
     * @param {string} message - Confirmation message.
     * @param {Object} options - Dialog options.
     * @returns {void}
     */
    createDialog(message, options) {
        const dialog = this.mount({
            overlayClass: 'confirm-dialog-overlay',
            dialogClass: 'confirm-dialog modal-dialog modal-dialog--sm',
            templatePath: './src/templates/dialogs/confirmDialog.html',
            templateId: 'tpl-confirm-dialog'
        });

        const title = options.title || 'Confirm Action';
        const confirmText = options.confirmText || 'Confirm';
        const cancelText = options.cancelText || 'Cancel';
        const isDangerous = options.dangerous !== false;

        const titleEl = dialog.querySelector('[data-role="title"]');
        const messageEl = dialog.querySelector('[data-role="message"]');
        const cancelTextEl = dialog.querySelector('[data-role="cancel-text"]');
        const confirmTextEl = dialog.querySelector('[data-role="confirm-text"]');

        if (titleEl) {titleEl.textContent = title;}
        if (messageEl) {messageEl.textContent = message;}
        if (cancelTextEl) {cancelTextEl.textContent = cancelText;}
        if (confirmTextEl) {
            confirmTextEl.textContent = confirmText;
            confirmTextEl.classList.toggle('btn-danger', isDangerous);
            confirmTextEl.classList.toggle('btn-primary', !isDangerous);
        }

        this.setupEventListeners(dialog);
        this.focusCancelButton(dialog);
    }

    /**
     * Wires button clicks and Enter/Tab navigation. Escape/backdrop cancel is
     * handled by {@link BaseModal}.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element.
     * @returns {void}
     */
    setupEventListeners(dialog) {
        const cancelBtn = dialog.querySelector('#confirm-cancel-btn');
        const confirmBtn = dialog.querySelector('#confirm-confirm-btn');

        cancelBtn.addEventListener('click', () => this.cancel());
        confirmBtn.addEventListener('click', () => this.confirm());

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                this.confirm();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (document.activeElement === cancelBtn) {
                    confirmBtn.focus();
                } else {
                    cancelBtn.focus();
                }
            }
        };

        cancelBtn.addEventListener('keydown', handleKeyDown);
        confirmBtn.addEventListener('keydown', handleKeyDown);
    }

    /**
     * Focuses the cancel button by default to prevent accidental destructive actions.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element.
     * @returns {void}
     */
    focusCancelButton(dialog) {
        dialog.querySelector('#confirm-cancel-btn').focus();
    }

    /**
     * Confirms the action, resolving with true.
     *
     * @private
     * @returns {void}
     */
    confirm() {
        this._settle(true);
    }

    /**
     * Cancels the action, resolving with false.
     *
     * @private
     * @returns {void}
     */
    cancel() {
        this._settle(false);
    }

    /**
     * Dismiss (Escape / backdrop click) cancels.
     *
     * @protected
     * @returns {void}
     */
    onDismiss() {
        this.cancel();
    }

    /**
     * Resolves the pending promise once, tears down, and restores app focus.
     *
     * @private
     * @param {boolean} value - Value to resolve with.
     * @returns {void}
     */
    _settle(value) {
        if (this.resolve) {
            this.resolve(value);
            this.resolve = null;
        }
        this.destroy();

        const collectionsList = document.getElementById('collections-list');
        if (collectionsList) {
            collectionsList.focus();
        }
    }
}
