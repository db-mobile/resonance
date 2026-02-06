/**
 * @fileoverview Modal dialog for managing collection-scoped variables
 * @module ui/VariableManager
 */

/**
 * Variable management dialog with import/export functionality
 *
 * @class
 * @classdesc Provides a modal interface for CRUD operations on collection variables.
 * Supports key-value pair editing, import/export to JSON, and auto-adds empty rows.
 * Variables use {{variableName}} template syntax in requests.
 */
import { templateLoader } from '../templateLoader.js';

export class VariableManager {
    /**
     * Creates a VariableManager instance
     */
    constructor() {
        this.dialog = null;
        this.onSave = null;
        this.onCancel = null;
        this.keyDownHandler = null;
    }

    show(collectionName, variables = {}, options = {}) {
        return new Promise((resolve, _reject) => {
            this.onSave = resolve;
            this.onCancel = () => resolve(null);

            this.createDialog(collectionName, variables, options);
        });
    }

    createDialog(collectionName, variables, options) {
        this.dialog = document.createElement('div');
        this.dialog.className = 'variable-dialog-overlay modal-overlay';

        const dialogContent = document.createElement('div');
        dialogContent.className = 'variable-dialog modal-dialog modal-dialog--variable-manager modal-dialog--scroll-y';

        const title = options.title || `Variables - ${collectionName}`;

        const fragment = templateLoader.cloneSync(
            './src/templates/variables/variableManager.html',
            'tpl-variable-manager-dialog'
        );
        dialogContent.appendChild(fragment);

        const titleEl = dialogContent.querySelector('[data-role="title"]');
        if (titleEl) {
            titleEl.textContent = title;
        }

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
            this.addVariableRow(container);
        }
    }

    addVariableRow(container, name = '', value = '') {
        const fragment = templateLoader.cloneSync(
            './src/templates/variables/variableManager.html',
            'tpl-variable-manager-row'
        );
        const row = fragment.firstElementChild;

        row.querySelector('.remove-variable-btn').addEventListener('click', () => {
            row.remove();
        });

        const nameInput = row.querySelector('.variable-name');
        const valueInput = row.querySelector('.variable-value');

        // Set values directly via .value property to preserve special characters like {{ }}
        if (nameInput) {nameInput.value = name;}
        if (valueInput) {valueInput.value = value;}
        
        const autoAddRow = () => {
            const allRows = container.querySelectorAll('.variable-row');
            const lastRow = allRows[allRows.length - 1];
            const _lastNameInput = lastRow.querySelector('.variable-name');
            const _lastValueInput = lastRow.querySelector('.variable-value');

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

        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.close();
            }
        });

        this.keyDownHandler = this.handleKeyDown.bind(this);
        document.addEventListener('keydown', this.keyDownHandler, { once: false });
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
            alert(`Validation errors:\n\n${  errors.join('\n')}`);
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
            if (this.keyDownHandler) {
                document.removeEventListener('keydown', this.keyDownHandler);
                this.keyDownHandler = null;
            }
            this.dialog.remove();
            this.dialog = null;
        }
        this.onSave = null;
        this.onCancel = null;
    }

    showImportDialog() {
        const importDialog = document.createElement('div');
        importDialog.className = 'modal-overlay modal-overlay--dim';

        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog modal-dialog--md';
        const fragment = templateLoader.cloneSync(
            './src/templates/variables/variableManager.html',
            'tpl-variable-manager-import-dialog'
        );
        dialog.appendChild(fragment);
        importDialog.appendChild(dialog);

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
                alert(`Invalid JSON: ${  error.message}`);
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