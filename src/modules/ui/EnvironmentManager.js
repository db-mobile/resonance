import { templateLoader } from '../templateLoader.js';
import { DynamicVariablesReferenceDialog } from './DynamicVariablesReferenceDialog.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { RenameDialog } from './RenameDialog.js';
import { BaseModal } from './BaseModal.js';
import { toast } from './Toast.js';
import { translate } from '../utils/translate.js';
import { applySecretState as applyRowSecretState, toggleRevealed } from './secretToggle.js';

const TEMPLATE_PATH = './src/templates/environment/environmentManager.html';

const SECRET_ROW_SELECTORS = Object.freeze({
    valueInput: '.var-value-input',
    secretBtn: '.var-secret-btn',
    revealBtn: '.var-reveal-btn'
});

export class EnvironmentManager extends BaseModal {
    constructor(environmentService) {
        super();
        this.service = environmentService;
        this.currentEnvironmentId = null;
        this.resolve = null;
    }

    /** @returns {Promise<boolean>} */
    show() {
        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.createDialog().catch((error) => {
                this.resolve = null;
                reject(error);
            });
        });
    }

    /** @returns {Promise<void>} */
    async createDialog() {
        this.currentEnvironmentId = null;

        await templateLoader.loadTemplateFile(TEMPLATE_PATH);

        this.mount({
            overlayClass: 'environment-manager-overlay',
            dialogClass: 'environment-manager-dialog modal-dialog modal-dialog--environment-manager',
            templatePath: TEMPLATE_PATH,
            templateId: 'tpl-environment-manager-dialog-content'
        });

        this.setupEventListeners();

        await this.loadEnvironments();
    }

    setupEventListeners() {
        const createBtn = this.dialog.querySelector('#env-create-btn');
        const closeBtn = this.dialog.querySelector('#env-close-btn');
        const importBtn = this.dialog.querySelector('#env-import-btn');
        const exportAllBtn = this.dialog.querySelector('#env-export-all-btn');

        createBtn.addEventListener('click', () => this.handleCreateEnvironment());
        closeBtn.addEventListener('click', () => this.close());
        importBtn.addEventListener('click', () => this.handleImport());
        exportAllBtn.addEventListener('click', () => this.handleExportAll());
    }

    async loadEnvironments() {
        try {
            const environments = await this.service.getAllEnvironments();
            const activeEnvId = await this.service.getActiveEnvironmentId();

            const listContainer = this.dialog.querySelector('#env-list');
            listContainer.innerHTML = '';

            environments.forEach(env => {
                const item = this.createEnvironmentListItem(env, env.id === activeEnvId);
                listContainer.appendChild(item);
            });

            const envToSelect = activeEnvId || environments[0]?.id;
            if (envToSelect) {
                await this.selectEnvironment(envToSelect);
            }
        } catch {}
    }

    createEnvironmentListItem(environment, isActive) {
        const item = document.createElement('div');
        item.className = 'env-list-item';
        item.dataset.envId = environment.id;

        if (this.currentEnvironmentId === environment.id) {
            item.classList.add('is-selected');
        }

        const colorIndicator = document.createElement('span');
        colorIndicator.className = `env-color-indicator${environment.color ? '' : ' is-hidden'}`;
        if (environment.color) {
            colorIndicator.style.setProperty('--env-indicator-color', environment.color);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'env-list-item-name';
        nameSpan.textContent = environment.name;

        item.appendChild(colorIndicator);
        item.appendChild(nameSpan);

        if (isActive) {
            const badge = document.createElement('span');
            badge.className = 'env-list-item-active-badge icon icon-14 icon-check';
            badge.title = 'Active environment';
            badge.setAttribute('role', 'img');
            badge.setAttribute('aria-label', 'Active environment');
            item.appendChild(badge);
        }

        item.addEventListener('click', () => this.selectEnvironment(environment.id));

        return item;
    }

    async selectEnvironment(environmentId) {
        this.currentEnvironmentId = environmentId;

        this.dialog.querySelectorAll('.env-list-item').forEach(item => {
            const isSelected = item.dataset.envId === environmentId;
            item.classList.toggle('is-selected', isSelected);
        });

        await this.loadEnvironmentDetails(environmentId);
    }

    async loadEnvironmentDetails(environmentId) {
        try {
            const environment = await this.service.getAllEnvironments().then(envs =>
                envs.find(e => e.id === environmentId)
            );

            if (!environment) {return;}

            const activeEnvId = await this.service.getActiveEnvironmentId();
            const isActive = environment.id === activeEnvId;

            const detailsContainer = this.dialog.querySelector('#env-details');
            detailsContainer.innerHTML = '';

            const detailsFragment = await templateLoader.clone(
                './src/templates/environment/environmentManager.html',
                'tpl-environment-manager-details'
            );
            detailsContainer.appendChild(detailsFragment);

            const setActiveBtn = detailsContainer.querySelector('#env-set-active-btn');
            const activeBadge = detailsContainer.querySelector('.env-manager-active-badge');
            if (setActiveBtn && activeBadge) {
                setActiveBtn.classList.toggle('is-hidden', isActive);
                activeBadge.classList.toggle('is-hidden', !isActive);
            }

            const nameInput = detailsContainer.querySelector('#env-name-input');
            if (nameInput) {
                nameInput.value = environment.name;
            }

            this._renderColorState(environment.color);
            const colorInput = detailsContainer.querySelector('#env-color-input');
            if (colorInput) {
                colorInput.dataset.savedColor = environment.color || '';
            }

            this.setupDetailEventListeners(environment);

            this.loadVariables(environment);
        } catch {}
    }

    /**
     * @param {string|null|undefined} color
     * @returns {void}
     */
    _renderColorState(color) {
        const colorInput = this.dialog.querySelector('#env-color-input');
        const colorValue = this.dialog.querySelector('#env-color-value');
        const clearColorBtn = this.dialog.querySelector('#env-color-clear-btn');
        if (colorInput) {
            colorInput.value = color || '#4F46E5';
        }
        if (colorValue) {
            colorValue.textContent = color || 'None';
        }
        if (clearColorBtn) {
            clearColorBtn.disabled = !color;
        }
    }

    /** @param {Object} environment */
    setupDetailEventListeners(environment) {
        const dynamicVarsBtn = this.dialog.querySelector('#env-dynamic-vars-btn');
        if (dynamicVarsBtn) {
            dynamicVarsBtn.addEventListener('click', () => new DynamicVariablesReferenceDialog().show());
        }

        this._wireNameInput(environment);
        this._wireColorControls(environment);
        this._wireEnvironmentActions(environment);
    }

    /** @param {Object} environment */
    _wireNameInput(environment) {
        const nameInput = this.dialog.querySelector('#env-name-input');
        if (!nameInput) {
            return;
        }

        nameInput.addEventListener('blur', async () => {
            const newName = nameInput.value.trim();
            if (newName && newName !== environment.name) {
                try {
                    await this.service.updateEnvironment(environment.id, { name: newName });
                    await this.loadEnvironments();
                } catch (error) {
                    toast.error(error.message);
                    nameInput.value = environment.name;
                }
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                nameInput.blur();
            }
        });
    }

    /** @param {Object} environment */
    _wireColorControls(environment) {
        const colorInput = this.dialog.querySelector('#env-color-input');
        const colorValue = this.dialog.querySelector('#env-color-value');
        const clearColorBtn = this.dialog.querySelector('#env-color-clear-btn');

        const saveColor = async (nextColor) => {
            try {
                const color = nextColor || null;
                await this.service.updateEnvironment(environment.id, { color });
                if (colorInput) {
                    colorInput.dataset.savedColor = color || '';
                }
                await this.loadEnvironments();
                await this.loadEnvironmentDetails(environment.id);
            } catch (error) {
                toast.error(error.message);
                this._renderColorState(environment.color);
            }
        };

        if (colorInput) {
            colorInput.addEventListener('input', () => {
                if (colorValue) {
                    colorValue.textContent = colorInput.value.toUpperCase();
                }
                if (clearColorBtn) {
                    clearColorBtn.disabled = false;
                }
            });

            colorInput.addEventListener('change', async () => {
                const nextColor = colorInput.value.toUpperCase();
                if (nextColor !== (colorInput.dataset.savedColor || '')) {
                    await saveColor(nextColor);
                }
            });
        }

        if (clearColorBtn) {
            clearColorBtn.addEventListener('click', async () => {
                if (!environment.color) {
                    return;
                }

                this._renderColorState(null);
                await saveColor(null);
            });
        }
    }

    /** @param {Object} environment */
    _wireEnvironmentActions(environment) {
        const setActiveBtn = this.dialog.querySelector('#env-set-active-btn');
        const duplicateBtn = this.dialog.querySelector('#env-duplicate-btn');
        const exportBtn = this.dialog.querySelector('#env-export-btn');
        const deleteBtn = this.dialog.querySelector('#env-delete-btn');
        const addVariableBtn = this.dialog.querySelector('#env-add-variable-btn');

        if (setActiveBtn) {
            setActiveBtn.addEventListener('click', async () => {
                try {
                    await this.service.switchEnvironment(environment.id);
                    await this.loadEnvironments();
                    await this.loadEnvironmentDetails(environment.id);
                } catch (error) {
                    toast.error(error.message);
                }
            });
        }

        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', async () => {
                try {
                    const newEnv = await this.service.duplicateEnvironment(environment.id);
                    await this.loadEnvironments();
                    this.selectEnvironment(newEnv.id);
                } catch (error) {
                    toast.error(error.message);
                }
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                try {
                    const exported = await this.service.exportEnvironment(environment.id);
                    const json = JSON.stringify(exported, null, 2);
                    const filename = `${environment.name.replace(/[^a-z0-9]/gi, '_')}_environment.json`;
                    await this.saveJsonExport(
                        filename,
                        json
                    );
                } catch (error) {
                    toast.error(error.message);
                }
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await new ConfirmDialog().show(
                    `Are you sure you want to delete the environment "${environment.name}"?`,
                    { title: 'Delete Environment', confirmText: 'Delete', dangerous: true }
                );
                if (confirmed) {
                    try {
                        await this.service.deleteEnvironment(environment.id);
                        this.currentEnvironmentId = null;
                        await this.loadEnvironments();
                    } catch (error) {
                        toast.error(error.message);
                    }
                }
            });
        }

        if (addVariableBtn) {
            addVariableBtn.addEventListener('click', async () => {
                const row = await this.addVariableRow({});
                row?.querySelector('.var-name-input')?.focus();
            });
        }
    }

    /** @param {Object} environment */
    async loadVariables(environment) {
        const container = this.dialog.querySelector('#env-variables-container');
        container.innerHTML = '';

        const variables = environment?.variables || {};
        const secretKeys = Array.isArray(environment?.secretKeys) ? environment.secretKeys : [];

        const rows = await Promise.all(Object.entries(variables).map(async ([name, value]) => {
            const isSecret = secretKeys.includes(name);
            const resolvedValue = isSecret
                ? await this.service.getSecretValue(environment.id, name)
                : value;
            return { name, value: resolvedValue, isSecret };
        }));
        await Promise.all(rows.map(row => this.addVariableRow(row, container)));
        this.updateVariablesEmptyState();
    }

    updateVariablesEmptyState() {
        const container = this.dialog.querySelector('#env-variables-container');
        const emptyState = this.dialog.querySelector('.env-variables-empty');
        if (!container || !emptyState) {return;}
        emptyState.classList.toggle('is-hidden', container.childElementCount > 0);
    }

    /** @returns {Promise<HTMLElement|null>} */
    addVariableRow({ name = '', value = '', isSecret = false }, container = null) {
        if (!container) {
            container = this.dialog.querySelector('#env-variables-container');
        }

        return templateLoader
            .clone('./src/templates/environment/environmentManager.html', 'tpl-environment-manager-variable-row')
            .then((fragment) => {
                const row = fragment.firstElementChild;
                container.appendChild(fragment);

                const nameInput = row.querySelector('.var-name-input');
                const valueInput = row.querySelector('.var-value-input');
                if (nameInput) {nameInput.value = name;}
                if (valueInput) {valueInput.value = value;}

                this.applySecretState(row, isSecret);

                this.setupVariableRowListeners(row, name);
                this.updateVariablesEmptyState();
                return row;
            })
            .catch(() => null);
    }

    /**
     * @param {HTMLElement} row
     * @param {boolean} isSecret
     */
    applySecretState(row, isSecret) {
        const { secretBtn } = applyRowSecretState(row, isSecret, SECRET_ROW_SELECTORS);
        secretBtn?.setAttribute('aria-pressed', String(isSecret));
    }

    setupVariableRowListeners(row, originalName) {
        const nameInput = row.querySelector('.var-name-input');
        const valueInput = row.querySelector('.var-value-input');
        const deleteBtn = row.querySelector('.var-delete-btn');
        const secretBtn = row.querySelector('.var-secret-btn');
        const revealBtn = row.querySelector('.var-reveal-btn');

        const isSecret = () => row.dataset.secret === 'true';
        let currentName = originalName;

        const saveVariable = async () => {
            const name = nameInput.value.trim();
            const value = valueInput.value.trim();

            if (!name) {
                if (currentName) {
                    await this.deleteVariable(currentName);
                    currentName = '';
                }
                return;
            }

            if (currentName && name !== currentName) {
                await this.deleteVariable(currentName);
            }

            await this.setVariable(name, value, isSecret());
            currentName = name;
        };

        nameInput.addEventListener('blur', saveVariable);
        valueInput.addEventListener('blur', saveVariable);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {valueInput.focus();}
        });

        valueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {saveVariable();}
        });

        if (secretBtn) {
            secretBtn.addEventListener('click', async () => {
                const next = !isSecret();
                this.applySecretState(row, next);
                const name = nameInput.value.trim();
                if (name) {
                    await this.setVariable(name, valueInput.value.trim(), next);
                }
            });
        }

        if (revealBtn) {
            revealBtn.addEventListener('click', () => toggleRevealed(valueInput, revealBtn));
        }

        deleteBtn.addEventListener('click', async () => {
            if (currentName) {
                await this.deleteVariable(currentName);
            }
            row.remove();
            this.updateVariablesEmptyState();
        });
    }

    /**
     * @param {string} name
     * @param {string} value
     * @param {boolean} [isSecret=false]
     */
    async setVariable(name, value, isSecret = false) {
        try {
            if (!this.currentEnvironmentId) {return;}
            await this.service.setVariable(this.currentEnvironmentId, name, value, isSecret);
        } catch (error) {
            toast.error(error.message);
        }
    }

    async deleteVariable(name) {
        try {
            if (!this.currentEnvironmentId) {return;}
            await this.service.deleteVariable(this.currentEnvironmentId, name);
        } catch (error) {
            toast.error(error.message);
        }
    }

    async handleCreateEnvironment() {
        const name = await new RenameDialog().show(translate('environment_manager.create_default_name', 'New Environment'), {
            title: translate('environment_manager.create_title', 'Create Environment'),
            label: translate('environment_manager.create_label', 'Enter environment name:'),
            confirmText: translate('environment_manager.create_confirm', 'Create')
        });
        if (!name) {return;}

        try {
            const newEnv = await this.service.createEnvironment(name.trim());
            await this.loadEnvironments();
            this.selectEnvironment(newEnv.id);
        } catch (error) {
            toast.error(error.message);
        }
    }

    async handleImport() {
        const merge = await new ConfirmDialog().show(
            'Merge with existing environments, or replace all of them?',
            { title: 'Import Environments', confirmText: 'Merge', cancelText: 'Replace All', dangerous: false, dismissValue: null }
        );
        if (merge === null) {return;}

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
            try {
                const file = e.target.files[0];
                if (!file) {return;}

                const text = await file.text();
                const parsed = JSON.parse(text);

                await this.service.importEnvironments(parsed, merge);
                await this.loadEnvironments();
            } catch (error) {
                toast.error(translate('environment_manager.import_error', 'Error importing environments: {{message}}', { message: error.message }));
            }
        };

        input.click();
    }

    async handleExportAll() {
        try {
            const exported = await this.service.exportAllEnvironments();
            const json = JSON.stringify(exported, null, 2);
            await this.saveJsonExport(
                `resonance_environments_${Date.now()}.json`,
                json
            );
        } catch (error) {
            toast.error(error.message);
        }
    }

    async saveJsonExport(filename, json) {
        if (window.backendAPI?.environments?.saveJsonExport) {
            await window.backendAPI.environments.saveJsonExport(filename, json);
            return;
        }

        throw new Error('Native export is not available in this runtime');
    }

    /** @returns {void} */
    onDismiss() {
        this.close();
    }

    /** @returns {void} */
    close() {
        this.destroy();

        if (this.resolve) {
            const { resolve } = this;
            this.resolve = null;
            resolve(true);
        }
    }
}
