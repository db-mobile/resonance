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
import { toast } from './Toast.js';
import { DynamicVariablesReferenceDialog } from './DynamicVariablesReferenceDialog.js';

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

    /**
     * @param {string} collectionName
     * @param {Array<{name: string, value: string, secret?: boolean}>} entries - Variable
     *   editor entries. (A plain `{name: value}` object is also accepted for convenience.)
     * @param {Object} [options]
     * @returns {Promise<{variables: Object, secretKeys: string[]}|null>} The edited
     *   variables and the names flagged secret, or null if cancelled.
     */
    show(collectionName, entries = [], options = {}) {
        return new Promise((resolve, _reject) => {
            this.onSave = resolve;
            this.onCancel = () => resolve(null);

            this.createDialog(collectionName, this._normalizeEntries(entries), options);
        });
    }

    /**
     * Accepts either editor entries or a legacy flat `{name: value}` object.
     *
     * @private
     * @param {Array|Object} entries
     * @returns {Array<{name: string, value: string, secret: boolean}>}
     */
    _normalizeEntries(entries) {
        if (Array.isArray(entries)) {
            return entries.map(e => ({ name: e.name, value: e.value ?? '', secret: Boolean(e.secret) }));
        }
        return Object.entries(entries || {}).map(([name, value]) => ({ name, value, secret: false }));
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

    populateVariables(entries) {
        const container = this.dialog.querySelector('#variables-container');
        const list = this._normalizeEntries(entries);

        if (list.length === 0) {
            this.addVariableRow(container);
        } else {
            list.forEach(entry => {
                this.addVariableRow(container, entry.name, entry.value, entry.secret);
            });
            this.addVariableRow(container);
        }
    }

    addVariableRow(container, name = '', value = '', secret = false) {
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

        if (nameInput) {nameInput.value = name;}
        if (valueInput) {valueInput.value = value;}

        this._applySecretState(row, secret);
        this._setupSecretControls(row);

        const autoAddRow = () => {
            const allRows = container.querySelectorAll('.variable-row');
            const lastRow = allRows[allRows.length - 1];

            if (row === lastRow && (nameInput.value.trim() || valueInput.value.trim())) {
                this.addVariableRow(container);
            }
        };

        nameInput.addEventListener('input', autoAddRow);
        valueInput.addEventListener('input', autoAddRow);

        container.appendChild(row);
    }

    /**
     * Reflects a row's secret state: masks the value, shows the reveal toggle, and
     * highlights the lock button.
     *
     * @private
     */
    _applySecretState(row, isSecret) {
        const valueInput = row.querySelector('.variable-value');
        const secretBtn = row.querySelector('.variable-secret-btn');
        const revealBtn = row.querySelector('.variable-reveal-btn');

        row.dataset.secret = isSecret ? 'true' : 'false';
        if (secretBtn) {secretBtn.classList.toggle('is-secret', isSecret);}
        if (revealBtn) {revealBtn.classList.toggle('is-hidden', !isSecret);}
        if (valueInput) {valueInput.type = isSecret ? 'password' : 'text';}
        if (revealBtn) {
            const icon = revealBtn.querySelector('.icon');
            if (icon) {
                icon.classList.toggle('icon-eye', true);
                icon.classList.toggle('icon-eye-off', false);
            }
            revealBtn.title = 'Show value';
        }
    }

    /**
     * Wires the per-row secret toggle and reveal toggle.
     *
     * @private
     */
    _setupSecretControls(row) {
        const valueInput = row.querySelector('.variable-value');
        const secretBtn = row.querySelector('.variable-secret-btn');
        const revealBtn = row.querySelector('.variable-reveal-btn');

        if (secretBtn) {
            secretBtn.addEventListener('click', () => {
                this._applySecretState(row, row.dataset.secret !== 'true');
            });
        }

        if (revealBtn) {
            revealBtn.addEventListener('click', () => {
                const showing = valueInput.type === 'text';
                valueInput.type = showing ? 'password' : 'text';
                const icon = revealBtn.querySelector('.icon');
                if (icon) {
                    icon.classList.toggle('icon-eye', showing);
                    icon.classList.toggle('icon-eye-off', !showing);
                }
                revealBtn.title = showing ? 'Show value' : 'Hide value';
            });
        }
    }

    setupEventListeners(dialogContent) {
        const addBtn = dialogContent.querySelector('#add-variable-btn');
        const closeBtn = dialogContent.querySelector('#variables-close-btn');
        const cancelBtn = dialogContent.querySelector('#variables-cancel-btn');
        const saveBtn = dialogContent.querySelector('#variables-save-btn');
        const importBtn = dialogContent.querySelector('#import-variables-btn');
        const exportBtn = dialogContent.querySelector('#export-variables-btn');
        const referenceBtn = dialogContent.querySelector('#dynamic-vars-reference-btn');
        const container = dialogContent.querySelector('#variables-container');

        addBtn.addEventListener('click', () => {
            this.addVariableRow(container);
        });

        closeBtn.addEventListener('click', () => this.close());
        cancelBtn.addEventListener('click', () => this.close());
        saveBtn.addEventListener('click', () => this.save());

        importBtn.addEventListener('click', () => this.showImportDialog());
        exportBtn.addEventListener('click', () => this.exportVariables());

        if (referenceBtn) {
            referenceBtn.addEventListener('click', () => new DynamicVariablesReferenceDialog().show());
        }

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
        const secretKeys = [];
        const errors = [];

        rows.forEach((row, index) => {
            const nameInput = row.querySelector('.variable-name');
            const valueInput = row.querySelector('.variable-value');
            const name = nameInput.value.trim();
            const value = valueInput.value.trim();
            const isSecret = row.dataset.secret === 'true';

            if (name || value) {
                if (!name) {
                    errors.push(`Row ${index + 1}: Variable name is required`);
                    return;
                }

                if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) {
                    errors.push(`Row ${index + 1}: Invalid variable name "${name}". Must start with a letter, digit, or underscore, followed by letters, digits, underscores, hyphens, or dots.`);
                    return;
                }

                if (variables[name] !== undefined) {
                    errors.push(`Duplicate variable name: "${name}"`);
                    return;
                }

                variables[name] = value;
                if (isSecret) {
                    secretKeys.push(name);
                }
            }
        });

        if (errors.length > 0) {
            toast.error(`Validation errors:\n\n${errors.join('\n')}`);
            return;
        }

        if (this.onSave) {
            this.onSave({ variables, secretKeys });
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
                toast.error(`Invalid JSON: ${error.message}`);
            }
        });
    }

    importVariables(variables) {
        const container = this.dialog.querySelector('#variables-container');
        container.innerHTML = '';
        this.populateVariables(variables);
    }

    async exportVariables() {
        const container = this.dialog.querySelector('#variables-container');
        const rows = container.querySelectorAll('.variable-row');
        const variables = {};

        rows.forEach(row => {
            const name = row.querySelector('.variable-name').value.trim();
            const value = row.querySelector('.variable-value').value.trim();
            const isSecret = row.dataset.secret === 'true';
            if (name) {
                variables[name] = isSecret ? '' : value;
            }
        });

        const json = JSON.stringify(variables, null, 2);

        if (window.backendAPI?.environments?.saveJsonExport) {
            try {
                const result = await window.backendAPI.environments.saveJsonExport('collection-variables.json', json);
                if (result?.cancelled) {
                    return;
                }
                toast.success('Variables exported successfully');
            } catch (error) {
                toast.error(`Export failed: ${error.message}`);
            }
        } else {
            toast.error('Native export is not available in this runtime');
        }
    }
}