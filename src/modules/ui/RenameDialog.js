/**
 * @fileoverview Modal dialog component for renaming collections and endpoints
 * @module ui/RenameDialog
 */

/**
 * Modal rename dialog with text input validation
 *
 * @class
 * @classdesc Provides a modal dialog for renaming items with keyboard support,
 * input validation, and auto-focus. Supports Enter/Escape shortcuts and preserves
 * special characters like template variables.
 */
export class RenameDialog {
    /**
     * Creates a RenameDialog instance
     */
    constructor() {
        /** @type {HTMLElement|null} The dialog overlay element */
        this.overlay = null;
        /** @type {Function|null} Callback for confirm action */
        this.onConfirm = null;
        /** @type {Function|null} Callback for cancel action */
        this.onCancel = null;
    }

    /**
     * Shows rename dialog and waits for user input
     *
     * Displays a modal dialog with text input pre-filled with current name.
     * Returns a promise that resolves to the new name (trimmed) or null if cancelled.
     *
     * @param {string} currentName - The current name to pre-fill
     * @param {Object} [options={}] - Dialog configuration options
     * @param {string} [options.title='Rename Collection'] - Dialog title
     * @param {string} [options.label='Collection Name:'] - Input field label
     * @param {string} [options.confirmText='Rename'] - Confirm button label
     * @returns {Promise<string|null>} Resolves to new name (trimmed) or null if cancelled
     */
    show(currentName, options = {}) {
        return new Promise((resolve, _reject) => {
            this.onConfirm = resolve;
            this.onCancel = () => resolve(null);

            this.createDialog(currentName, options);
        });
    }

    /**
     * Creates and displays the rename dialog DOM elements
     *
     * Builds dialog with inline styles for theme compatibility. Sets input value
     * using .value property to preserve special characters like {{ and }}.
     *
     * @private
     * @param {string} currentName - Current name to pre-fill
     * @param {Object} options - Dialog options
     * @returns {void}
     */
    createDialog(currentName, options) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'rename-dialog-overlay';
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
        dialog.className = 'rename-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            min-width: 400px;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        const title = options.title || 'Rename Collection';
        const label = options.label || 'Collection Name:';
        const confirmText = options.confirmText || 'Rename';

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">${title}</h3>
            <div style="margin-bottom: 16px;">
                <label for="rename-input" style="display: block; margin-bottom: 8px; color: var(--text-primary); font-weight: 500;">${label}</label>
                <input type="text" id="rename-input"
                       style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); font-size: 14px; box-sizing: border-box; background: var(--bg-secondary); color: var(--text-primary);">
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="rename-cancel-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Cancel</button>
                <button id="rename-confirm-btn" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">${confirmText}</button>
            </div>
        `;

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        // Set value directly via .value property to preserve special characters like {{ }}
        const input = dialog.querySelector('#rename-input');
        if (input) {input.value = currentName;}

        this.setupEventListeners(dialog);
        this.focusInput(dialog);
    }

    /**
     * Attaches event listeners for dialog interactions
     *
     * Handles button clicks, Enter/Escape keyboard shortcuts, and click-outside-to-close.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @returns {void}
     */
    setupEventListeners(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        const cancelBtn = dialog.querySelector('#rename-cancel-btn');
        const confirmBtn = dialog.querySelector('#rename-confirm-btn');

        cancelBtn.addEventListener('click', () => this.close());
        
        confirmBtn.addEventListener('click', () => this.confirm(nameInput.value));

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirm(nameInput.value);
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    /**
     * Focuses and selects text in the rename input
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @returns {void}
     */
    focusInput(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        nameInput.focus();
        nameInput.select();
    }

    /**
     * Handles confirm action with validation
     *
     * Trims whitespace and rejects empty names. Resolves promise with
     * the new name and closes dialog.
     *
     * @private
     * @param {string} newName - The entered name
     * @returns {void}
     */
    confirm(newName) {
        const trimmedName = newName.trim();
        if (trimmedName) {
            if (this.onConfirm) {
                this.onConfirm(trimmedName);
            }
        } else {
            return;
        }
        this.cleanup();
    }

    /**
     * Handles cancel action
     *
     * Resolves promise with null and closes dialog.
     *
     * @private
     * @returns {void}
     */
    close() {
        if (this.onCancel) {
            this.onCancel();
        }
        this.cleanup();
    }

    /**
     * Removes dialog from DOM and cleans up callbacks
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