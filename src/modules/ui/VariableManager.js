/**
 * UI component for managing collection variables
 * Follows Single Responsibility Principle - only handles variable management UI
 */
export class VariableManager {
    constructor() {
        this.dialog = null;
        this.onSave = null;
        this.onCancel = null;
    }

    show(collectionName, variables = {}, options = {}) {
        return new Promise((resolve, reject) => {
            this.onSave = resolve;
            this.onCancel = () => resolve(null);
            
            this.createDialog(collectionName, variables, options);
        });
    }

    createDialog(collectionName, variables, options) {
        this.dialog = document.createElement('div');
        this.dialog.className = 'variable-dialog-overlay';
        this.dialog.style.cssText = `
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

        const dialogContent = document.createElement('div');
        dialogContent.className = 'variable-dialog';
        dialogContent.style.cssText = `
            background: var(--bg-color, #ffffff);
            border-radius: 8px;
            padding: 24px;
            min-width: 600px;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            border: 1px solid var(--border-color, #e0e0e0);
        `;

        const title = options.title || `Variables - ${collectionName}`;

        dialogContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: var(--text-color, #333333);">${this.escapeHtml(title)}</h3>
                <div style="display: flex; gap: 8px;">
                    <button id="add-variable-btn" style="padding: 6px 12px; border: 1px solid var(--primary-color, #007bff); background: transparent; color: var(--primary-color, #007bff); border-radius: 4px; cursor: pointer; font-size: 12px;">+ Add Variable</button>
                    <button id="import-variables-btn" style="padding: 6px 12px; border: 1px solid var(--border-color, #e0e0e0); background: transparent; border-radius: 4px; cursor: pointer; font-size: 12px;">Import</button>
                    <button id="export-variables-btn" style="padding: 6px 12px; border: 1px solid var(--border-color, #e0e0e0); background: transparent; border-radius: 4px; cursor: pointer; font-size: 12px;">Export</button>
                </div>
            </div>
            
            <div style="margin-bottom: 16px; padding: 12px; background: var(--info-bg, #f8f9fa); border-radius: 4px; border-left: 4px solid var(--info-border, #007bff);">
                <p style="margin: 0; font-size: 14px; color: var(--text-color, #333333);">
                    <strong>Usage:</strong> Define variables here and use them in your requests with <code>{{ variableName }}</code> syntax.
                    <br>Variables can be used in URLs, headers, query parameters, and request bodies.
                </p>
            </div>

            <div id="variables-container" style="margin-bottom: 20px;">
                <!-- Variables will be populated here -->
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="variables-cancel-btn" style="padding: 8px 16px; border: 1px solid var(--border-color, #e0e0e0); background: transparent; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="variables-save-btn" style="padding: 8px 16px; border: none; background: var(--primary-color, #007bff); color: white; border-radius: 4px; cursor: pointer;">Save Variables</button>
            </div>
        `;

        this.dialog.appendChild(dialogContent);
        document.body.appendChild(this.dialog);

        this.populateVariables(variables);
        this.setupEventListeners(dialogContent);
    }

    populateVariables(variables) {
        const container = this.dialog.querySelector('#variables-container');
        
        if (Object.keys(variables).length === 0) {
            this.addVariableRow(container);
        } else {
            Object.entries(variables).forEach(([name, value]) => {
                this.addVariableRow(container, name, value);
            });
            // Add one empty row for new variables
            this.addVariableRow(container);
        }
    }

    addVariableRow(container, name = '', value = '') {
        const row = document.createElement('div');
        row.className = 'variable-row';
        row.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        `;

        row.innerHTML = `
            <input type="text" class="variable-name" value="${this.escapeHtml(name)}" placeholder="Variable name"
                   style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color, #e0e0e0); border-radius: 4px; font-size: 14px;">
            <input type="text" class="variable-value" value="${this.escapeHtml(value)}" placeholder="Variable value"
                   style="flex: 2; padding: 8px 12px; border: 1px solid var(--border-color, #e0e0e0); border-radius: 4px; font-size: 14px;">
            <button class="remove-variable-btn" style="padding: 8px; border: 1px solid var(--danger-color, #dc3545); background: transparent; color: var(--danger-color, #dc3545); border-radius: 4px; cursor: pointer; min-width: 70px;">Remove</button>
        `;

        // Add event listeners
        row.querySelector('.remove-variable-btn').addEventListener('click', () => {
            row.remove();
        });

        // Auto-add new row when typing in the last empty row
        const nameInput = row.querySelector('.variable-name');
        const valueInput = row.querySelector('.variable-value');
        
        const autoAddRow = () => {
            const allRows = container.querySelectorAll('.variable-row');
            const lastRow = allRows[allRows.length - 1];
            const lastNameInput = lastRow.querySelector('.variable-name');
            const lastValueInput = lastRow.querySelector('.variable-value');
            
            if (row === lastRow && (nameInput.value.trim() || valueInput.value.trim())) {
                this.addVariableRow(container);
            }
        };

        nameInput.addEventListener('input', autoAddRow);
        valueInput.addEventListener('input', autoAddRow);

        container.appendChild(row);
    }

    setupEventListeners(dialogContent) {
        const addBtn = dialogContent.querySelector('#add-variable-btn');
        const cancelBtn = dialogContent.querySelector('#variables-cancel-btn');
        const saveBtn = dialogContent.querySelector('#variables-save-btn');
        const importBtn = dialogContent.querySelector('#import-variables-btn');
        const exportBtn = dialogContent.querySelector('#export-variables-btn');
        const container = dialogContent.querySelector('#variables-container');

        addBtn.addEventListener('click', () => {
            this.addVariableRow(container);
        });

        cancelBtn.addEventListener('click', () => this.close());
        saveBtn.addEventListener('click', () => this.save());

        importBtn.addEventListener('click', () => this.showImportDialog());
        exportBtn.addEventListener('click', () => this.exportVariables());

        // Close on overlay click
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.close();
            }
        });

        // Handle escape key
        document.addEventListener('keydown', this.handleKeyDown.bind(this), { once: false });
    }

    handleKeyDown(e) {
        if (e.key === 'Escape' && this.dialog) {
            this.close();
        }
    }

    save() {
        const container = this.dialog.querySelector('#variables-container');
        const rows = container.querySelectorAll('.variable-row');
        const variables = {};
        const errors = [];

        rows.forEach((row, index) => {
            const nameInput = row.querySelector('.variable-name');
            const valueInput = row.querySelector('.variable-value');
            const name = nameInput.value.trim();
            const value = valueInput.value.trim();

            if (name || value) {
                if (!name) {
                    errors.push(`Row ${index + 1}: Variable name is required`);
                    return;
                }

                // Validate variable name
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
                    errors.push(`Row ${index + 1}: Invalid variable name "${name}". Use letters, numbers, and underscores only. Must start with letter or underscore.`);
                    return;
                }

                if (variables[name] !== undefined) {
                    errors.push(`Duplicate variable name: "${name}"`);
                    return;
                }

                variables[name] = value;
            }
        });

        if (errors.length > 0) {
            alert('Validation errors:\n\n' + errors.join('\n'));
            return;
        }

        if (this.onSave) {
            this.onSave(variables);
        }
        this.cleanup();
    }

    close() {
        if (this.onCancel) {
            this.onCancel();
        }
        this.cleanup();
    }

    cleanup() {
        if (this.dialog) {
            document.removeEventListener('keydown', this.handleKeyDown.bind(this));
            this.dialog.remove();
            this.dialog = null;
        }
        this.onSave = null;
        this.onCancel = null;
    }

    showImportDialog() {
        const importDialog = document.createElement('div');
        importDialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        `;

        importDialog.innerHTML = `
            <div style="background: white; padding: 24px; border-radius: 8px; min-width: 500px;">
                <h4 style="margin: 0 0 16px 0;">Import Variables</h4>
                <textarea id="import-textarea" placeholder="Paste JSON object with variables..." 
                          style="width: 100%; height: 200px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; resize: vertical;"></textarea>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                    <button id="import-cancel">Cancel</button>
                    <button id="import-confirm" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px;">Import</button>
                </div>
            </div>
        `;

        document.body.appendChild(importDialog);

        importDialog.querySelector('#import-cancel').addEventListener('click', () => {
            importDialog.remove();
        });

        importDialog.querySelector('#import-confirm').addEventListener('click', () => {
            try {
                const text = importDialog.querySelector('#import-textarea').value.trim();
                const variables = JSON.parse(text);
                
                if (typeof variables !== 'object' || Array.isArray(variables)) {
                    throw new Error('Variables must be an object');
                }

                this.importVariables(variables);
                importDialog.remove();
            } catch (error) {
                alert('Invalid JSON: ' + error.message);
            }
        });
    }

    importVariables(variables) {
        const container = this.dialog.querySelector('#variables-container');
        container.innerHTML = '';
        this.populateVariables(variables);
    }

    exportVariables() {
        const container = this.dialog.querySelector('#variables-container');
        const rows = container.querySelectorAll('.variable-row');
        const variables = {};

        rows.forEach(row => {
            const name = row.querySelector('.variable-name').value.trim();
            const value = row.querySelector('.variable-value').value.trim();
            if (name) {
                variables[name] = value;
            }
        });

        const json = JSON.stringify(variables, null, 2);
        
        // Create and download file
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'collection-variables.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}