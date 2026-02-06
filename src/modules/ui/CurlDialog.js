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
import { templateLoader } from '../templateLoader.js';

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
        this.overlay.className = 'curl-dialog-overlay modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'curl-dialog modal-dialog modal-dialog--wide';

        const fragment = templateLoader.cloneSync(
            './src/templates/curl/curlDialog.html',
            'tpl-curl-dialog'
        );
        dialog.appendChild(fragment);

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
                copyBtn.classList.add('is-copied');

                setTimeout(() => {
                    buttonText.textContent = originalText;
                    copyBtn.classList.remove('is-copied');
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
