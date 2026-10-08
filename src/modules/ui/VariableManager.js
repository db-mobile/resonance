/**
 * @fileoverview Modal dialog for managing collection-scoped variables
 * @module ui/VariableManager
 */

import { templateLoader } from '../templateLoader.js';
import { toast } from './Toast.js';
import { DynamicVariablesReferenceDialog } from './DynamicVariablesReferenceDialog.js';
import { pushEscapeHandler } from './modalEscape.js';
import { BaseModal } from './BaseModal.js';
import { applySecretState, toggleRevealed } from './secretToggle.js';

const SECRET_ROW_SELECTORS = Object.freeze({
    valueInput: '.variable-value',
    secretBtn: '.variable-secret-btn',
    revealBtn: '.variable-reveal-btn'
});

export class VariableManager extends BaseModal {
    constructor() {
        super();
        this.onSave = null;
        this.onCancel = null;
        this.releaseEscape = null;
    }

    /**
     * @param {string} collectionName
     * @param {Array<{name: string, value: string, secret?: boolean}>} entries
     * @param {Object} [options]
     * @returns {Promise<{variables: Object, secretKeys: string[]}|null>}
     */
    show(collectionName, entries = [], options = {}) {
        return new Promise((resolve, _reject) => {
            this.onSave = resolve;
            this.onCancel = () => resolve(null);

            this.createDialog(collectionName, this._normalizeEntries(entries), options);
        });
    }

    /**
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
        const dialogContent = this.mount({
            overlayClass: 'variable-dialog-overlay',
            dialogClass: 'variable-dialog modal-dialog modal-dialog--variable-manager modal-dialog--scroll-y',
            templatePath: './src/templates/variables/variableManager.html',
            templateId: 'tpl-variable-manager-dialog',
            closeOnEscape: false,
            closeOnOverlayClick: false
        });

        const titleEl = dialogContent.querySelector('[data-role="title"]');
        if (titleEl) {
            titleEl.textContent = options.title || `Variables - ${collectionName}`;
        }

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

    _applySecretState(row, isSecret) {
        applySecretState(row, isSecret, SECRET_ROW_SELECTORS);
    }

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
            revealBtn.addEventListener('click', () => toggleRevealed(valueInput, revealBtn));
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

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });

        this.releaseEscape = pushEscapeHandler(() => {
            if (this.dialog) {
                this.close();
            }
        });
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

        this.onSave?.({ variables, secretKeys });
        this.cleanup();
    }

    close() {
        this.onCancel?.();
        this.cleanup();
    }

    cleanup() {
        if (this.releaseEscape) {
            this.releaseEscape();
            this.releaseEscape = null;
        }

        this.destroy();

        this.onSave = null;
        this.onCancel = null;
    }

    showImportDialog() {
        const importModal = new BaseModal();
        const dialog = importModal.mount({
            overlayClass: 'variable-import-overlay',
            dialogClass: 'modal-dialog modal-dialog--md',
            templatePath: './src/templates/variables/variableManager.html',
            templateId: 'tpl-variable-manager-import-dialog',
            closeOnOverlayClick: false
        });

        dialog.querySelector('#import-cancel').addEventListener('click', () => {
            importModal.destroy();
        });

        dialog.querySelector('#import-confirm').addEventListener('click', () => {
            try {
                const text = dialog.querySelector('#import-textarea').value.trim();
                const variables = JSON.parse(text);
                
                if (typeof variables !== 'object' || Array.isArray(variables)) {
                    throw new Error('Variables must be an object');
                }

                this.importVariables(variables);
                importModal.destroy();
            } catch (error) {
                toast.error(`Invalid JSON: ${error.message}`);
            }
        });

        dialog.querySelector('#import-textarea').focus();
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