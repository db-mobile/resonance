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
        this.overlay.className = 'confirm-dialog-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            min-width: 400px;
            max-width: 500px;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        const title = options.title || 'Confirm Action';
        const confirmText = options.confirmText || 'Confirm';
        const cancelText = options.cancelText || 'Cancel';
        const isDangerous = options.dangerous !== false; // Default to true for delete confirmations

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">${this.escapeHtml(title)}</h3>
            <div style="margin-bottom: 24px;">
                <p style="margin: 0; color: var(--text-primary); white-space: pre-wrap; line-height: 1.5;">${this.escapeHtml(message)}</p>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="confirm-cancel-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">${this.escapeHtml(cancelText)}</button>
                <button id="confirm-confirm-btn" style="padding: 8px 16px; border: none; background: ${isDangerous ? '#dc2626' : 'var(--color-primary)'}; color: white; border-radius: var(--radius-sm); cursor: pointer;">${this.escapeHtml(confirmText)}</button>
            </div>
        `;

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
