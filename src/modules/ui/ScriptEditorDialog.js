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
        this.overlay.className = 'script-editor-overlay';
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

        // Create dialog
        const dialog = document.createElement('div');
        dialog.className = 'script-editor-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            width: 800px;
            max-width: 90%;
            height: 600px;
            max-height: 80vh;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
            display: flex;
            flex-direction: column;
        `;

        dialog.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; color: var(--text-primary);">Edit Scripts</h3>
                <button id="script-editor-close" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 24px; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" aria-label="Close">&times;</button>
            </div>

            <div class="script-tabs" style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--border-light);">
                <button class="script-tab-btn active" data-tab="pre-request" style="padding: 8px 16px; background: none; border: none; border-bottom: 2px solid var(--color-primary); color: var(--color-primary); cursor: pointer; font-weight: 500;">
                    Pre-request Script
                </button>
                <button class="script-tab-btn" data-tab="test" style="padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); cursor: pointer;">
                    Test Script
                </button>
            </div>

            <div class="script-tab-content" data-tab="pre-request" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                <textarea id="pre-request-script-editor" style="width: 100%; flex: 1; padding: 12px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-light); border-radius: var(--radius-sm); resize: none;">${this.escapeHtml(this.currentScripts.preRequestScript || '')}</textarea>
                <div style="margin-top: 8px; padding: 8px; background: var(--bg-secondary); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-secondary);">
                    <strong>Available APIs:</strong> request, environment, console, Date, Math, JSON
                </div>
            </div>

            <div class="script-tab-content" data-tab="test" style="flex: 1; display: none; flex-direction: column; overflow: hidden;">
                <textarea id="test-script-editor" style="width: 100%; flex: 1; padding: 12px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-light); border-radius: var(--radius-sm); resize: none;">${this.escapeHtml(this.currentScripts.testScript || '')}</textarea>
                <div style="margin-top: 8px; padding: 8px; background: var(--bg-secondary); border-radius: var(--radius-sm); font-size: 12px; color: var(--text-secondary);">
                    <strong>Available APIs:</strong> request, response, environment, console, expect(), Date, Math, JSON
                </div>
            </div>

            <details style="margin-top: 16px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-sm); font-size: 13px;">
                <summary style="cursor: pointer; font-weight: 500; color: var(--text-primary);">API Documentation</summary>
                <div style="margin-top: 12px; color: var(--text-secondary); line-height: 1.6;">
                    <h4 style="margin: 8px 0; color: var(--text-primary);">Pre-request Script:</h4>
                    <code>request.headers['key'] = 'value';</code><br>
                    <code>environment.set('name', 'value');</code><br>
                    <code>console.log('message');</code><br>

                    <h4 style="margin: 16px 0 8px; color: var(--text-primary);">Test Script:</h4>
                    <code>expect(response.status).toBe(200);</code><br>
                    <code>expect(response.body.users).toBeDefined();</code><br>
                    <code>environment.set('userId', response.body.id);</code><br>

                    <h4 style="margin: 16px 0 8px; color: var(--text-primary);">Assertions:</h4>
                    <code>toBe, toEqual, toContain, toBeDefined, toBeTruthy, toBeFalsy, toBeGreaterThan, toBeLessThan</code>
                </div>
            </details>

            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                <button id="script-editor-cancel" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Cancel</button>
                <button id="script-editor-save" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">Save</button>
            </div>
        `;

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

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
                btn.style.borderBottomColor = 'var(--color-primary)';
                btn.style.color = 'var(--color-primary)';
            } else {
                btn.classList.remove('active');
                btn.style.borderBottomColor = 'transparent';
                btn.style.color = 'var(--text-secondary)';
            }
        });

        // Update tab content
        const tabContents = this.overlay.querySelectorAll('.script-tab-content');
        tabContents.forEach(content => {
            if (content.dataset.tab === tabName) {
                content.style.display = 'flex';
            } else {
                content.style.display = 'none';
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
