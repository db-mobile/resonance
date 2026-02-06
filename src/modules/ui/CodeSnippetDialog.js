/**
 * @fileoverview Dialog for generating code snippets in multiple languages
 * @module ui/CodeSnippetDialog
 */

import { generateCode, SUPPORTED_LANGUAGES } from '../codeGenerator.js';
import { templateLoader } from '../templateLoader.js';

/**
 * Multi-language code snippet generator dialog
 *
 * @class
 * @classdesc Displays generated code snippets for API requests in multiple languages
 * (cURL, JavaScript, Python, etc.). Provides language selector, syntax highlighting,
 * and copy-to-clipboard functionality.
 */
export class CodeSnippetDialog {
    /**
     * Creates a CodeSnippetDialog instance
     */
    constructor() {
        this.overlay = null;
        this.currentLanguage = 'curl'; // Default language
        this.config = null;
    }

    show(config, initialLanguage = 'curl') {
        this.config = config;
        this.currentLanguage = initialLanguage;
        this.createDialog();
    }

    createDialog() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'code-snippet-dialog-overlay modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'code-snippet-dialog modal-dialog modal-dialog--code-snippet';

        const fragment = templateLoader.cloneSync(
            './src/templates/codeSnippets/codeSnippetDialog.html',
            'tpl-code-snippet-dialog'
        );
        dialog.appendChild(fragment);

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

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        // Update code display
        this.updateCodeDisplay(dialog);

        // Setup event listeners
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

        // Close buttons
        closeBtn.addEventListener('click', () => this.close());
        closeBottomBtn.addEventListener('click', () => this.close());

        // Language selector
        languageSelector.addEventListener('change', (e) => {
            this.currentLanguage = e.target.value;
            this.updateCodeDisplay(dialog);
        });

        // Copy button
        copyBtn.addEventListener('click', async () => {
            try {
                const code = commandDisplay.textContent;
                await navigator.clipboard.writeText(code);

                const iconSpan = copyBtn.querySelector('.icon');
                iconSpan.classList.remove('icon-copy');
                iconSpan.classList.add('icon-check');
                copyBtn.classList.add('copied');

                setTimeout(() => {
                    iconSpan.classList.remove('icon-check');
                    iconSpan.classList.add('icon-copy');
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                alert('Failed to copy to clipboard');
            }
        });

        // Keyboard shortcuts
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                this.close();
                document.removeEventListener('keydown', handleKeyDown);
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        // Click outside to close
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    close() {
        this.cleanup();
    }

    cleanup() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }
}
