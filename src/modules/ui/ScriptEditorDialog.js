/**
 * @fileoverview Dialog for editing pre-request and test scripts
 * @module ui/ScriptEditorDialog
 */

/**
 * Script editor dialog with tabbed interface
 * Provides separate editors for pre-request and test scripts
 *
 * @class
 * @classdesc Modal dialog for editing scripts with syntax highlighting and help
 */
import { templateLoader } from '../templateLoader.js';

export class ScriptEditorDialog {
    /**
     * Creates a ScriptEditorDialog instance
     */
    constructor() {
        this.overlay = null;
        this.currentScripts = null;
        this.onSave = null;
        this.currentTab = 'pre-request';
    }

    /**
     * Show the script editor dialog
     * @param {Object} scripts - Current scripts {preRequestScript, testScript}
     * @param {Function} onSave - Callback when scripts are saved
     */
    show(scripts, onSave) {
        this.currentScripts = { ...scripts };
        this.onSave = onSave;
        this.createDialog();
    }

    /**
     * Create and display the dialog
     * @private
     */
    createDialog() {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'script-editor-overlay modal-overlay';

        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'script-editor-dialog modal-dialog modal-dialog--script-editor';

        const fragment = templateLoader.cloneSync(
            './src/templates/scripts/scriptEditorDialog.html',
            'tpl-script-editor-dialog'
        );
        dialog.appendChild(fragment);

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        const preRequestEl = this.overlay.querySelector('#pre-request-script-editor');
        const testEl = this.overlay.querySelector('#test-script-editor');

        if (preRequestEl) {
            preRequestEl.value = this.currentScripts.preRequestScript || '';
        }
        if (testEl) {
            testEl.value = this.currentScripts.testScript || '';
        }

        // Setup event listeners
        this.setupEventListeners();
    }

    /**
     * Setup event listeners for dialog interactions
     * @private
     */
    setupEventListeners() {
        // Close button
        const closeBtn = document.getElementById('script-editor-close');
        closeBtn.addEventListener('click', () => this.close(false));

        // Cancel button
        const cancelBtn = document.getElementById('script-editor-cancel');
        cancelBtn.addEventListener('click', () => this.close(false));

        // Save button
        const saveBtn = document.getElementById('script-editor-save');
        saveBtn.addEventListener('click', () => this.save());

        // Tab switching
        const tabButtons = this.overlay.querySelectorAll('.script-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Close on escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.close(false);
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Close on outside click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close(false);
            }
        });
    }

    /**
     * Switch between tabs
     * @private
     * @param {string} tabName - Tab name ('pre-request' or 'test')
     */
    switchTab(tabName) {
        this.currentTab = tabName;

        // Update tab buttons
        const tabButtons = this.overlay.querySelectorAll('.script-tab-btn');
        tabButtons.forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab content
        const tabContents = this.overlay.querySelectorAll('.script-tab-content');
        tabContents.forEach(content => {
            if (content.dataset.tab === tabName) {
                content.classList.add('is-active');
            } else {
                content.classList.remove('is-active');
            }
        });
    }

    /**
     * Save scripts and close dialog
     * @private
     */
    save() {
        // Get script values
        const preRequestScript = document.getElementById('pre-request-script-editor').value;
        const testScript = document.getElementById('test-script-editor').value;

        const savedScripts = {
            preRequestScript,
            testScript
        };

        // Call save callback
        if (this.onSave) {
            this.onSave(savedScripts);
        }

        this.close(true);
    }

    /**
     * Close dialog
     * @private
     * @param {boolean} saved - Whether scripts were saved
     */
    close(saved) {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }

        if (!saved && this.onSave) {
            this.onSave(null);
        }

        this.overlay = null;
    }

    /**
     * Escape HTML special characters
     * @private
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
