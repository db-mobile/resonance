/**
 * @fileoverview Dialog for generating code snippets in multiple languages
 * @module ui/CodeSnippetDialog
 */

import { generateCode, SUPPORTED_LANGUAGES } from '../codeGenerator.js';
import { templateLoader } from '../templateLoader.js';
import { toast } from './Toast.js';
import { BaseModal } from './BaseModal.js';

/**
 * Multi-language code snippet generator dialog
 *
 * @class
 * @classdesc Displays generated code snippets for API requests in multiple languages
 * (cURL, JavaScript, Python, etc.). Provides language selector, syntax highlighting,
 * and copy-to-clipboard. Escape and click-outside-to-close are handled by {@link BaseModal}.
 * @augments BaseModal
 */
export class CodeSnippetDialog extends BaseModal {
    /**
     * Creates a CodeSnippetDialog instance
     */
    constructor() {
        super();
        this.currentLanguage = 'curl';
        this.config = null;
    }

    show(config, initialLanguage = 'curl') {
        this.config = config;
        this.currentLanguage = initialLanguage;

        const dialog = this.mount({
            overlayClass: 'code-snippet-dialog-overlay',
            dialogClass: 'code-snippet-dialog modal-dialog modal-dialog--code-snippet',
            templatePath: './src/templates/codeSnippets/codeSnippetDialog.html',
            templateId: 'tpl-code-snippet-dialog'
        });

        const languageSelector = dialog.querySelector('#language-selector');
        if (languageSelector) {
            languageSelector.innerHTML = '';

            SUPPORTED_LANGUAGES.forEach(lang => {
                const optFragment = templateLoader.cloneSync(
                    './src/templates/codeSnippets/codeSnippetDialog.html',
                    'tpl-code-snippet-language-option'
                );
                const optEl = optFragment.firstElementChild;
                optEl.value = lang.id;
                optEl.textContent = `${lang.name}${lang.description ? ` (${lang.description})` : ''}`;
                optEl.selected = lang.id === this.currentLanguage;
                languageSelector.appendChild(optEl);
            });
        }

        this.updateCodeDisplay(dialog);
        this.setupEventListeners(dialog);
    }

    updateCodeDisplay(dialog) {
        const commandDisplay = dialog.querySelector('#code-snippet-display');
        try {
            const code = generateCode(this.currentLanguage, this.config);
            commandDisplay.textContent = code;
        } catch (error) {
            commandDisplay.textContent = `Error generating code: ${error.message}`;
        }
    }

    setupEventListeners(dialog) {
        const closeBtn = dialog.querySelector('#code-snippet-close-btn');
        const closeBottomBtn = dialog.querySelector('#code-snippet-close-bottom-btn');
        const copyBtn = dialog.querySelector('#code-snippet-copy-btn');
        const languageSelector = dialog.querySelector('#language-selector');
        const commandDisplay = dialog.querySelector('#code-snippet-display');

        closeBtn.addEventListener('click', () => this.destroy());
        closeBottomBtn.addEventListener('click', () => this.destroy());

        languageSelector.addEventListener('change', (e) => {
            this.currentLanguage = e.target.value;
            this.updateCodeDisplay(dialog);
        });

        copyBtn.addEventListener('click', async () => {
            try {
                const code = commandDisplay.textContent;
                await navigator.clipboard.writeText(code);

                const iconSpan = copyBtn.querySelector('.icon');
                iconSpan.classList.remove('icon-copy');
                iconSpan.classList.add('icon-check');
                copyBtn.classList.add('is-copied');

                setTimeout(() => {
                    iconSpan.classList.remove('icon-check');
                    iconSpan.classList.add('icon-copy');
                    copyBtn.classList.remove('is-copied');
                }, 2000);
            } catch (err) {
                toast.error('Failed to copy to clipboard');
            }
        });
    }
}
