/**
 * @fileoverview Dialog for generating code snippets in multiple languages
 * @module ui/CodeSnippetDialog
 */

import { generateCode, SUPPORTED_LANGUAGES } from '../codeGenerator.js';

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
        this.overlay.className = 'code-snippet-dialog-overlay';
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
        dialog.className = 'code-snippet-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            min-width: 700px;
            max-width: 90%;
            max-height: 80vh;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
            display: flex;
            flex-direction: column;
        `;

        // Create language options HTML
        const languageOptions = SUPPORTED_LANGUAGES.map(lang =>
            `<option value="${lang.id}" ${lang.id === this.currentLanguage ? 'selected' : ''}>
                ${lang.name}${lang.description ? ` (${lang.description})` : ''}
            </option>`
        ).join('');

        dialog.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; color: var(--text-primary);">Code Snippet</h3>
                <button id="code-snippet-close-btn" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 24px; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" aria-label="Close">&times;</button>
            </div>

            <div style="margin-bottom: 16px;">
                <label for="language-selector" style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 14px;">Language:</label>
                <div class="language-selector-container" style="position: relative;">
                    <select id="language-selector" class="language-selector" style="width: 100%; appearance: none; padding: 8px 12px; padding-right: calc(var(--space-5) + 12px); border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary); font-size: 14px; cursor: pointer; transition: all var(--transition-fast);">
                        ${languageOptions}
                    </select>
                    <svg class="select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-secondary);">
                        <polyline points="2 4 6 8 10 4"></polyline>
                    </svg>
                </div>
            </div>

            <div style="margin-bottom: 16px; flex: 1; overflow: auto;">
                <pre id="code-snippet-display" style="background: var(--bg-secondary); padding: 16px; border-radius: var(--radius-sm); overflow-x: auto; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5; color: var(--text-primary); margin: 0; white-space: pre-wrap; word-break: break-word;"></pre>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="code-snippet-copy-btn" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 8px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy to Clipboard</span>
                </button>
                <button id="code-snippet-close-bottom-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Close</button>
            </div>
        `;

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
            console.error('Code generation error:', error);
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

                const buttonText = copyBtn.querySelector('span');
                const originalText = buttonText.textContent;
                buttonText.textContent = 'Copied!';
                copyBtn.style.background = 'var(--color-success, #10b981)';

                setTimeout(() => {
                    buttonText.textContent = originalText;
                    copyBtn.style.background = 'var(--color-primary)';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy to clipboard:', err);
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
