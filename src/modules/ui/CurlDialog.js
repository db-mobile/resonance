/**
 * @fileoverview Dialog component for displaying and copying cURL commands
 * @module ui/CurlDialog
 * @deprecated Use CodeSnippetDialog instead for multi-language code generation
 */

import { toast } from './Toast.js';
import { BaseModal } from './BaseModal.js';

/**
 * Modal dialog for displaying cURL commands
 *
 * @class
 * @classdesc Shows a generated cURL command in a modal with copy-to-clipboard.
 * Escape and click-outside-to-close are handled by {@link BaseModal}.
 * @augments BaseModal
 * @deprecated Use CodeSnippetDialog for multi-language code export
 */
export class CurlDialog extends BaseModal {
    /**
     * Shows the cURL command dialog.
     *
     * @param {string} curlCommand - The cURL command string to display.
     * @returns {void}
     */
    show(curlCommand) {
        const dialog = this.mount({
            overlayClass: 'curl-dialog-overlay',
            dialogClass: 'curl-dialog modal-dialog modal-dialog--wide',
            templatePath: './src/templates/curl/curlDialog.html',
            templateId: 'tpl-curl-dialog'
        });

        dialog.querySelector('#curl-command-display').textContent = curlCommand;
        this.setupEventListeners(dialog, curlCommand);
    }

    /**
     * Wires close buttons and copy-to-clipboard.
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element.
     * @param {string} curlCommand - cURL command for clipboard copy.
     * @returns {void}
     */
    setupEventListeners(dialog, curlCommand) {
        dialog.querySelector('#curl-close-btn').addEventListener('click', () => this.destroy());
        dialog.querySelector('#curl-close-bottom-btn').addEventListener('click', () => this.destroy());

        const copyBtn = dialog.querySelector('#curl-copy-btn');
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
                toast.error('Failed to copy to clipboard');
            }
        });
    }
}
