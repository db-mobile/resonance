/**
 * UI Dialog for managing environments
 * Allows creating, editing, deleting, and duplicating environments
 */
import { templateLoader } from '../templateLoader.js';

export class EnvironmentManager {
    constructor(environmentService) {
        this.service = environmentService;
        this.dialog = null;
        this.currentEnvironmentId = null;
        this.resolve = null;
    }

    /**
     * Show environment manager dialog
     */
    show() {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog();
        });
    }

    /**
     * Create and display dialog
     */
    async createDialog() {
        // Reset selection so active environment is selected
        this.currentEnvironmentId = null;

        // Create overlay
        this.dialog = document.createElement('div');
        this.dialog.className = 'environment-manager-overlay modal-overlay';

        const dialogContent = document.createElement('div');
        dialogContent.className = 'environment-manager-dialog modal-dialog';

        try {
            const fragment = await templateLoader.clone(
                './src/templates/environment/environmentManager.html',
                'tpl-environment-manager-dialog-content'
            );
            dialogContent.appendChild(fragment);
        } catch (error) {
            void error;
            return;
        }

        this.dialog.appendChild(dialogContent);
        document.body.appendChild(this.dialog);

        // Setup event listeners
        this.setupEventListeners();

        // Load environments
        await this.loadEnvironments();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const createBtn = this.dialog.querySelector('#env-create-btn');
        const closeBtn = this.dialog.querySelector('#env-close-btn');
        const importBtn = this.dialog.querySelector('#env-import-btn');
        const exportAllBtn = this.dialog.querySelector('#env-export-all-btn');

        createBtn.addEventListener('click', () => this.handleCreateEnvironment());
        closeBtn.addEventListener('click', () => this.close(true));
        importBtn.addEventListener('click', () => this.handleImport());
        exportAllBtn.addEventListener('click', () => this.handleExportAll());

        // Close on overlay click
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.close(true);
            }
        });

        // Close on Escape key
        this.escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.close(true);
            }
        };
        document.addEventListener('keydown', this.escapeHandler);
    }

    /**
     * Load and display environments
     */
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

            // Always select the active environment when loading (unless user already selected something)
            // This ensures switching environments then opening dialog shows the new active environment
            const envToSelect = activeEnvId || environments[0]?.id;
            if (envToSelect) {
                await this.selectEnvironment(envToSelect);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Create environment list item
     */
    createEnvironmentListItem(environment, isActive) {
        const item = document.createElement('div');
        item.className = 'env-list-item';
        item.dataset.envId = environment.id;

        if (this.currentEnvironmentId === environment.id) {
            item.classList.add('is-selected');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'env-list-item-name';
        nameSpan.textContent = environment.name;

        if (isActive) {
            const badge = document.createElement('span');
            badge.textContent = '✓';
            badge.className = 'env-list-item-active-badge';
            nameSpan.appendChild(badge);
        }

        item.appendChild(nameSpan);

        item.addEventListener('click', () => this.selectEnvironment(environment.id));

        return item;
    }

    /**
     * Select environment and show details
     */
    async selectEnvironment(environmentId) {
        this.currentEnvironmentId = environmentId;

        // Update selection UI
        this.dialog.querySelectorAll('.env-list-item').forEach(item => {
            const isSelected = item.dataset.envId === environmentId;
            item.classList.toggle('is-selected', isSelected);
        });

        // Load environment details
        await this.loadEnvironmentDetails(environmentId);
    }

    /**
     * Load environment details
     */
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

            // Set environment name directly via .value property to preserve special characters like {{ }}
            const nameInput = detailsContainer.querySelector('#env-name-input');
            if (nameInput) {
                nameInput.value = environment.name;
            }

            // Setup detail event listeners
            this.setupDetailEventListeners(environment);

            // Load variables
            this.loadVariables(environment.variables);
        } catch (error) {
            void error;
        }
    }

    /**
     * Setup event listeners for details panel
     */
    setupDetailEventListeners(environment) {
        const nameInput = this.dialog.querySelector('#env-name-input');
        const setActiveBtn = this.dialog.querySelector('#env-set-active-btn');
        const duplicateBtn = this.dialog.querySelector('#env-duplicate-btn');
        const exportBtn = this.dialog.querySelector('#env-export-btn');
        const deleteBtn = this.dialog.querySelector('#env-delete-btn');
        const addVariableBtn = this.dialog.querySelector('#env-add-variable-btn');

        // Name change
        if (nameInput) {
            nameInput.addEventListener('blur', async () => {
                const newName = nameInput.value.trim();
                if (newName && newName !== environment.name) {
                    try {
                        await this.service.updateEnvironment(environment.id, { name: newName });
                        await this.loadEnvironments();
                    } catch (error) {
                        this.showAlert(error.message);
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

        // Set active
        if (setActiveBtn) {
            setActiveBtn.addEventListener('click', async () => {
                try {
                    await this.service.switchEnvironment(environment.id);
                    await this.loadEnvironments();
                    await this.loadEnvironmentDetails(environment.id);
                } catch (error) {
                    this.showAlert(error.message);
                }
            });
        }

        // Duplicate
        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', async () => {
                try {
                    const newEnv = await this.service.duplicateEnvironment(environment.id);
                    await this.loadEnvironments();
                    this.selectEnvironment(newEnv.id);
                } catch (error) {
                    this.showAlert(error.message);
                }
            });
        }

        // Export
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                try {
                    const data = await this.service.exportEnvironment(environment.id);
                    const json = JSON.stringify(data, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${environment.name.replace(/[^a-z0-9]/gi, '_')}_environment.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                } catch (error) {
                    this.showAlert(error.message);
                }
            });
        }

        // Delete
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const confirmed = await this.showConfirmDialog(`Are you sure you want to delete the environment "${environment.name}"?`);
                if (confirmed) {
                    try {
                        await this.service.deleteEnvironment(environment.id);
                        this.currentEnvironmentId = null;
                        await this.loadEnvironments();
                    } catch (error) {
                        this.showAlert(error.message);
                    }
                }
            });
        }

        // Add variable
        if (addVariableBtn) {
            addVariableBtn.addEventListener('click', () => {
                this.addVariableRow({});
            });
        }
    }

    /**
     * Load variables for environment
     */
    loadVariables(variables) {
        const container = this.dialog.querySelector('#env-variables-container');
        container.innerHTML = '';

        Object.entries(variables).forEach(([name, value]) => {
            this.addVariableRow({ name, value }, container);
        });

        // Add empty row for new variable
        this.addVariableRow({}, container);
    }

    /**
     * Add variable input row
     */
    addVariableRow({ name = '', value = '' }, container = null) {
        if (!container) {
            container = this.dialog.querySelector('#env-variables-container');
        }

        templateLoader
            .clone('./src/templates/environment/environmentManager.html', 'tpl-environment-manager-variable-row')
            .then((fragment) => {
                const row = fragment.firstElementChild;
                container.appendChild(fragment);

                // Set values directly via .value property to preserve special characters like {{ }}
                const nameInput = row.querySelector('.var-name-input');
                const valueInput = row.querySelector('.var-value-input');
                if (nameInput) {nameInput.value = name;}
                if (valueInput) {valueInput.value = value;}

                // Setup variable row event listeners
                this.setupVariableRowListeners(row, name);
            })
            .catch((error) => {
                void error;
            });
    }

    /**
     * Setup event listeners for variable row
     */
    setupVariableRowListeners(row, originalName) {
        const nameInput = row.querySelector('.var-name-input');
        const valueInput = row.querySelector('.var-value-input');
        const deleteBtn = row.querySelector('.var-delete-btn');

        const saveVariable = async () => {
            const name = nameInput.value.trim();
            const value = valueInput.value.trim();

            if (!name) {
                if (originalName) {
                    // Delete variable if name is cleared
                    await this.deleteVariable(originalName);
                }
                return;
            }

            if (name !== originalName && originalName) {
                // Name changed - delete old and create new
                await this.deleteVariable(originalName);
            }

            await this.setVariable(name, value);
        };

        nameInput.addEventListener('blur', saveVariable);
        valueInput.addEventListener('blur', saveVariable);

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {valueInput.focus();}
        });

        valueInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {saveVariable();}
        });

        deleteBtn.addEventListener('click', async () => {
            if (originalName) {
                await this.deleteVariable(originalName);
            }
            row.remove();
        });
    }

    /**
     * Set variable in current environment
     */
    async setVariable(name, value) {
        try {
            const environment = await this.service.getAllEnvironments().then(envs =>
                envs.find(e => e.id === this.currentEnvironmentId)
            );

            if (!environment) {return;}

            const variables = { ...environment.variables, [name]: value };
            await this.service.updateEnvironment(this.currentEnvironmentId, { variables });
        } catch (error) {
            this.showAlert(error.message);
        }
    }

    /**
     * Delete variable from current environment
     */
    async deleteVariable(name) {
        try {
            const environment = await this.service.getAllEnvironments().then(envs =>
                envs.find(e => e.id === this.currentEnvironmentId)
            );

            if (!environment) {return;}

            const variables = { ...environment.variables };
            delete variables[name];
            await this.service.updateEnvironment(this.currentEnvironmentId, { variables });
        } catch (error) {
            this.showAlert(error.message);
        }
    }

    /**
     * Handle create environment
     */
    async handleCreateEnvironment() {
        const name = await this.showInputDialog('Create Environment', 'Enter environment name:', 'New Environment');
        if (!name) {return;}

        try {
            const newEnv = await this.service.createEnvironment(name.trim());
            await this.loadEnvironments();
            this.selectEnvironment(newEnv.id);
        } catch (error) {
            this.showAlert(error.message);
        }
    }

    /**
     * Show input dialog (replaces prompt)
     */
    showInputDialog(title, message, defaultValue = '') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'modal-dialog modal-dialog--sm';

            templateLoader
                .clone('./src/templates/environment/environmentManager.html', 'tpl-environment-manager-input-dialog')
                .then((fragment) => {
                    dialog.appendChild(fragment);

                    const titleEl = dialog.querySelector('[data-role="title"]');
                    const messageEl = dialog.querySelector('[data-role="message"]');
                    if (titleEl) {titleEl.textContent = title;}
                    if (messageEl) {messageEl.textContent = message;}

                    overlay.appendChild(dialog);
                    document.body.appendChild(overlay);

                    const input = dialog.querySelector('#input-dialog-input');
                    // Set value directly via .value property to preserve special characters like {{ }}
                    if (input) {input.value = defaultValue;}
                    const okBtn = dialog.querySelector('#input-dialog-ok');
                    const cancelBtn = dialog.querySelector('#input-dialog-cancel');

                    const cleanup = (value) => {
                        document.body.removeChild(overlay);
                        resolve(value);
                    };

                    okBtn.addEventListener('click', () => cleanup(input.value.trim()));
                    cancelBtn.addEventListener('click', () => cleanup(null));

                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {cleanup(input.value.trim());}
                        if (e.key === 'Escape') {cleanup(null);}
                    });

                    overlay.addEventListener('click', (e) => {
                        if (e.target === overlay) {cleanup(null);}
                    });

                    input.focus();
                    input.select();
                })
                .catch((error) => {
                    void error;
                    resolve(null);
                });
        });
    }

    /**
     * Show alert dialog (replaces alert)
     */
    showAlert(message) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog modal-dialog--sm';

        templateLoader
            .clone('./src/templates/environment/environmentManager.html', 'tpl-environment-manager-alert-dialog')
            .then((fragment) => {
                dialog.appendChild(fragment);

                const messageEl = dialog.querySelector('[data-role="message"]');
                if (messageEl) {messageEl.textContent = message;}

                overlay.appendChild(dialog);
                document.body.appendChild(overlay);

                const okBtn = dialog.querySelector('#alert-dialog-ok');

                const cleanup = () => {
                    document.body.removeChild(overlay);
                };

                okBtn.addEventListener('click', cleanup);

                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {cleanup();}
                });

                document.addEventListener('keydown', function escapeHandler(e) {
                    if (e.key === 'Escape' || e.key === 'Enter') {
                        cleanup();
                        document.removeEventListener('keydown', escapeHandler);
                    }
                });
            })
            .catch((error) => {
                void error;
            });
    }

    /**
     * Show confirm dialog (replaces confirm)
     */
    showConfirmDialog(message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'modal-dialog modal-dialog--sm';

            templateLoader
                .clone('./src/templates/environment/environmentManager.html', 'tpl-environment-manager-confirm-dialog')
                .then((fragment) => {
                    dialog.appendChild(fragment);

                    const messageEl = dialog.querySelector('[data-role="message"]');
                    if (messageEl) {messageEl.textContent = message;}

                    overlay.appendChild(dialog);
                    document.body.appendChild(overlay);

                    const okBtn = dialog.querySelector('#confirm-dialog-ok');
                    const cancelBtn = dialog.querySelector('#confirm-dialog-cancel');

                    const cleanup = (value) => {
                        document.body.removeChild(overlay);
                        resolve(value);
                    };

                    okBtn.addEventListener('click', () => cleanup(true));
                    cancelBtn.addEventListener('click', () => cleanup(false));

                    overlay.addEventListener('click', (e) => {
                        if (e.target === overlay) {cleanup(false);}
                    });

                    document.addEventListener('keydown', function escapeHandler(e) {
                        if (e.key === 'Escape') {
                            cleanup(false);
                            document.removeEventListener('keydown', escapeHandler);
                        }
                    });
                })
                .catch((error) => {
                    void error;
                    resolve(false);
                });
        });
    }

    /**
     * Handle import environments
     */
    async handleImport() {
        const merge = await this.showConfirmDialog('Merge with existing environments? (Cancel to replace all)');

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
            try {
                const file = e.target.files[0];
                if (!file) {return;}

                const text = await file.text();
                const data = JSON.parse(text);

                await this.service.importEnvironments(data, merge);
                await this.loadEnvironments();
            } catch (error) {
                this.showAlert(`Error importing environments: ${error.message}`);
            }
        };

        input.click();
    }

    /**
     * Handle export all environments
     */
    async handleExportAll() {
        try {
            const data = await this.service.exportAllEnvironments();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `resonance_environments_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            this.showAlert(error.message);
        }
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Close dialog
     */
    close(changed = false) {
        if (this.dialog) {
            document.body.removeChild(this.dialog);
            this.dialog = null;
        }

        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
        }

        if (this.resolve) {
            this.resolve(changed);
        }
    }
}
