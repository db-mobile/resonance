/**
 * @fileoverview Dialog component for displaying and copying cURL commands
 * @module ui/CurlDialog
 * @deprecated Use CodeSnippetDialog instead for multi-language code generation
 */

/**
 * Modal dialog for displaying cURL commands
 *
 * @class
 * @classdesc Shows generated cURL command in a modal dialog with copy-to-clipboard
 * functionality. Supports keyboard shortcuts (Escape) and click-outside-to-close.
 * @deprecated Use CodeSnippetDialog for multi-language code export
 */
export class CurlDialog {
    /**
     * Creates a CurlDialog instance
     */
    constructor() {
        this.overlay = null;
    }

    /**
     * Shows the cURL command dialog
     *
     * Displays a modal with the provided cURL command and copy functionality.
     *
     * @param {string} curlCommand - The cURL command string to display
     * @returns {void}
     */
    show(curlCommand) {
        this.createDialog(curlCommand);
    }

    /**
     * Creates and displays the dialog DOM elements
     *
     * Builds dialog with inline styles for theme compatibility. Includes
     * copy button, close buttons, and formatted command display.
     *
     * @private
     * @param {string} curlCommand - The cURL command to display
     * @returns {void}
     */
    createDialog(curlCommand) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'curl-dialog-overlay';
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
        dialog.className = 'curl-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            min-width: 600px;
            max-width: 90%;
            max-height: 80vh;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
            display: flex;
            flex-direction: column;
        `;

        dialog.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; color: var(--text-primary);">cURL Command</h3>
                <button id="curl-close-btn" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 24px; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" aria-label="Close">&times;</button>
            </div>
            <div style="margin-bottom: 16px; flex: 1; overflow: auto;">
                <pre id="curl-command-display" style="background: var(--bg-secondary); padding: 16px; border-radius: var(--radius-sm); overflow-x: auto; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5; color: var(--text-primary); margin: 0; white-space: pre-wrap; word-break: break-all;"></pre>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="curl-copy-btn" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 8px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy to Clipboard</span>
                </button>
                <button id="curl-close-bottom-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Close</button>
            </div>
        `;

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        const commandDisplay = dialog.querySelector('#curl-command-display');
        commandDisplay.textContent = curlCommand;

        this.setupEventListeners(dialog, curlCommand);
    }

    /**
     * Attaches event listeners for dialog interactions
     *
     * Handles close buttons, copy button with clipboard API, keyboard shortcuts,
     * and click-outside-to-close behavior.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @param {string} curlCommand - cURL command for clipboard copy
     * @returns {void}
     */
    setupEventListeners(dialog, curlCommand) {
        const closeBtn = dialog.querySelector('#curl-close-btn');
        const closeBottomBtn = dialog.querySelector('#curl-close-bottom-btn');
        const copyBtn = dialog.querySelector('#curl-copy-btn');

        closeBtn.addEventListener('click', () => this.close());
        closeBottomBtn.addEventListener('click', () => this.close());

        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(curlCommand);

                const buttonText = copyBtn.querySelector('span');
                const originalText = buttonText.textContent;
                buttonText.textContent = 'Copied!';
                copyBtn.style.background = 'var(--color-success, #10b981)';

                setTimeout(() => {
                    buttonText.textContent = originalText;
                    copyBtn.style.background = 'var(--color-primary)';
                }, 2000);
            } catch (err) {
                alert('Failed to copy to clipboard');
            }
        });

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                this.close();
                document.removeEventListener('keydown', handleKeyDown);
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    /**
     * Closes the dialog
     *
     * @returns {void}
     */
    close() {
        this.cleanup();
    }

    /**
     * Removes dialog from DOM
     *
     * Cleans up dialog element and overlay.
     *
     * @private
     * @returns {void}
     */
    cleanup() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}
