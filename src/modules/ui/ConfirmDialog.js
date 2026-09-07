/**
 * @fileoverview Modal confirmation dialog component for user confirmations
 * @module ui/ConfirmDialog
 */

import { BaseModal } from './BaseModal.js';

/** @augments */
export class ConfirmDialog extends BaseModal {
    constructor() {
        super();
        /** @type {Function|null} */
        this.resolve = null;
    }

    /**
     * @param {string} message
     * @param {Object} [options={}]
     * @param {string} [options.title='Confirm Action']
     * @param {string} [options.confirmText='Confirm']
     * @param {string} [options.cancelText='Cancel']
     * @param {boolean} [options.dangerous=true]
     * @returns {Promise<boolean>}
     */
    show(message, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog(message, options);
        });
    }

    /**
     * @param {string} message
     * @param {Object} options
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
     * @param {HTMLElement} dialog
     * @returns {void}
     */
    setupEventListeners(dialog) {
        const cancelBtn = dialog.querySelector('#confirm-cancel-btn');
        const confirmBtn = dialog.querySelector('#confirm-confirm-btn');

        cancelBtn.addEventListener('click', () => this.cancel());
        confirmBtn.addEventListener('click', () => this.confirm());

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (document.activeElement === cancelBtn) {
                    this.cancel();
                } else {
                    this.confirm();
                }
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
     * @param {HTMLElement} dialog
     * @returns {void}
     */
    focusCancelButton(dialog) {
        dialog.querySelector('#confirm-cancel-btn').focus();
    }

    /** @returns {void} */
    confirm() {
        this._settle(true);
    }

    /** @returns {void} */
    cancel() {
        this._settle(false);
    }

    /** @returns {void} */
    onDismiss() {
        this.cancel();
    }

    /**
     * @param {boolean} value
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
