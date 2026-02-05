/**
 * @fileoverview Modal confirmation dialog component for user confirmations
 * @module ui/ConfirmDialog
 */

/**
 * Modal dialog component for confirmation prompts
 *
 * @class
 * @classdesc Provides a customizable confirmation dialog with promise-based API.
 * Supports keyboard navigation (Enter/Escape/Tab), dangerous action styling,
 * and focus management for accessibility.
 */
import { templateLoader } from '../templateLoader.js';

export class ConfirmDialog {
    /**
     * Creates a ConfirmDialog instance
     */
    constructor() {
        this.overlay = null;
        this.onConfirm = null;
        this.onCancel = null;
    }

    /**
     * Shows confirmation dialog and waits for user response
     *
     * Displays a modal dialog with customizable message and buttons. Returns a promise
     * that resolves to true if confirmed, false if cancelled.
     *
     * @param {string} message - The confirmation message to display
     * @param {Object} [options={}] - Dialog configuration options
     * @param {string} [options.title='Confirm Action'] - Dialog title
     * @param {string} [options.confirmText='Confirm'] - Confirm button label
     * @param {string} [options.cancelText='Cancel'] - Cancel button label
     * @param {boolean} [options.dangerous=true] - Whether to style as dangerous action (red button)
     * @returns {Promise<boolean>} Resolves to true if confirmed, false if cancelled
     */
    show(message, options = {}) {
        return new Promise((resolve) => {
            this.onConfirm = () => resolve(true);
            this.onCancel = () => resolve(false);

            this.createDialog(message, options);
        });
    }

    /**
     * Creates and displays the dialog DOM elements
     *
     * Builds dialog with inline styles for theme compatibility. Escapes HTML
     * in message text for security.
     *
     * @private
     * @param {string} message - Confirmation message
     * @param {Object} options - Dialog options
     * @returns {void}
     */
    createDialog(message, options) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'confirm-dialog-overlay modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog modal-dialog modal-dialog--sm';

        const title = options.title || 'Confirm Action';
        const confirmText = options.confirmText || 'Confirm';
        const cancelText = options.cancelText || 'Cancel';
        const isDangerous = options.dangerous !== false; // Default to true for delete confirmations

        const fragment = templateLoader.cloneSync(
            './src/templates/dialogs/confirmDialog.html',
            'tpl-confirm-dialog'
        );
        dialog.appendChild(fragment);

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

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        this.setupEventListeners(dialog);
        this.focusCancelButton(dialog);
    }

    /**
     * Attaches event listeners for dialog interactions
     *
     * Handles button clicks, keyboard navigation (Enter/Escape/Tab), and
     * overlay click to dismiss. Prevents accidental confirmations.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @returns {void}
     */
    setupEventListeners(dialog) {
        const cancelBtn = dialog.querySelector('#confirm-cancel-btn');
        const confirmBtn = dialog.querySelector('#confirm-confirm-btn');

        cancelBtn.addEventListener('click', () => this.cancel());
        confirmBtn.addEventListener('click', () => this.confirm());

        // Keyboard navigation
        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                this.confirm();
            } else if (e.key === 'Escape') {
                this.cancel();
            } else if (e.key === 'Tab') {
                // Allow tab navigation between buttons
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

        // Click overlay to cancel
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.cancel();
            }
        });
    }

    /**
     * Focuses cancel button by default for safety
     *
     * Prevents accidental destructive actions by focusing the safe option.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @returns {void}
     */
    focusCancelButton(dialog) {
        // Focus cancel button by default for safety (prevents accidental deletions)
        const cancelBtn = dialog.querySelector('#confirm-cancel-btn');
        cancelBtn.focus();
    }

    /**
     * Handles confirm action
     *
     * Resolves promise with true and closes dialog.
     *
     * @private
     * @returns {void}
     */
    confirm() {
        if (this.onConfirm) {
            this.onConfirm();
        }
        this.cleanup();
    }

    /**
     * Handles cancel action
     *
     * Resolves promise with false and closes dialog.
     *
     * @private
     * @returns {void}
     */
    cancel() {
        if (this.onCancel) {
            this.onCancel();
        }
        this.cleanup();
    }

    /**
     * Removes dialog from DOM and restores focus
     *
     * Cleans up event listeners and restores focus to collections list.
     *
     * @private
     * @returns {void}
     */
    cleanup() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.onConfirm = null;
        this.onCancel = null;

        // Restore focus to the main window
        // Focus the collections list to ensure focus returns to the app
        const collectionsList = document.getElementById('collections-list');
        if (collectionsList) {
            collectionsList.focus();
        }
    }

    /**
     * Escapes HTML characters in text for safe display
     *
     * @private
     * @param {string} text - Text to escape
     * @returns {string} HTML-escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
