/**
 * UI Dialog for managing environments
 * Allows creating, editing, deleting, and duplicating environments
 */
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
        this.dialog.className = 'environment-manager-overlay';
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
        dialogContent.className = 'environment-manager-dialog';
        dialogContent.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            width: 90vw;
            max-width: 1000px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        dialogContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
                <h3 style="margin: 0; color: var(--text-primary);">Manage Environments</h3>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button id="env-import-btn" class="btn btn-outline btn-xs" title="Import Environments">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span>Import</span>
                    </button>
                    <button id="env-export-all-btn" class="btn btn-outline btn-xs" title="Export All Environments">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        <span>Export All</span>
                    </button>
                </div>
            </div>

            <div style="display: flex; gap: 16px; flex: 1; overflow: hidden;">
                <!-- Environment List -->
                <div style="flex: 0 0 250px; display: flex; flex-direction: column; border-right: 1px solid var(--border-light); padding-right: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h4 style="margin: 0; font-size: 14px; color: var(--text-secondary);">ENVIRONMENTS</h4>
                        <button id="env-create-btn" class="btn btn-outline-primary btn-sm" title="Create New Environment">+</button>
                    </div>
                    <div id="env-list" style="flex: 1; overflow-y: auto;"></div>
                </div>

                <!-- Environment Details -->
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div id="env-details" style="flex: 1; overflow-y: auto;">
                        <div style="text-align: center; color: var(--text-secondary); padding: 40px;">
                            Select an environment to view and edit its variables
                        </div>
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
                <button id="env-close-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Close</button>
            </div>
        `;

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
        item.style.cssText = `
            padding: 10px 12px;
            margin-bottom: 4px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: ${this.currentEnvironmentId === environment.id ? 'var(--color-primary-light)' : 'transparent'};
            border: 1px solid ${this.currentEnvironmentId === environment.id ? 'var(--color-primary)' : 'transparent'};
        `;

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `
            flex: 1;
            color: var(--text-primary);
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
        `;
        nameSpan.textContent = environment.name;

        if (isActive) {
            const badge = document.createElement('span');
            badge.textContent = '✓';
            badge.style.cssText = `
                color: var(--color-success);
                font-weight: bold;
            `;
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
            item.style.background = isSelected ? 'var(--color-primary-light)' : 'transparent';
            item.style.borderColor = isSelected ? 'var(--color-primary)' : 'transparent';
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
            detailsContainer.innerHTML = `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
                        <input
                            type="text"
                            id="env-name-input"
                            style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 16px; font-weight: 600;"
                        />
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                            ${!isActive ? '<button id="env-set-active-btn" class="btn btn-outline btn-xs" title="Set as Active"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Active</button>' : '<span style="color: var(--color-success); font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> ACTIVE</span>'}
                            <button id="env-duplicate-btn" class="btn btn-outline btn-xs" title="Duplicate Environment">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                            <button id="env-export-btn" class="btn btn-outline btn-xs" title="Export Environment">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="17 8 12 3 7 8"></polyline>
                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                            </button>
                            <button id="env-delete-btn" class="btn btn-outline btn-xs env-danger-btn" title="Delete Environment">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <h4 style="margin: 0; font-size: 14px; color: var(--text-secondary);">VARIABLES</h4>
                            <button id="env-add-variable-btn" class="btn btn-outline-primary btn-sm" title="Add Variable">+ Add</button>
                        </div>
                        <div id="env-variables-container"></div>
                    </div>
                </div>
            `;

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

        const row = document.createElement('div');
        row.className = 'env-variable-row';
        row.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 2fr auto;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        `;

        row.innerHTML = `
            <input
                type="text"
                class="var-name-input"
                placeholder="Variable name"
                style="padding: 8px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 13px;"
            />
            <input
                type="text"
                class="var-value-input"
                placeholder="Value"
                style="padding: 8px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 13px;"
            />
            <button class="var-delete-btn" style="padding: 6px 10px; border: 1px solid var(--border-light); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px;">×</button>
        `;

        container.appendChild(row);

        // Set values directly via .value property to preserve special characters like {{ }}
        const nameInput = row.querySelector('.var-name-input');
        const valueInput = row.querySelector('.var-value-input');
        if (nameInput) {nameInput.value = name;}
        if (valueInput) {valueInput.value = value;}

        // Setup variable row event listeners
        this.setupVariableRowListeners(row, name);
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
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: var(--bg-primary);
                border-radius: var(--radius-xl);
                padding: 24px;
                min-width: 400px;
                box-shadow: var(--shadow-xl);
                border: 1px solid var(--border-light);
            `;

            dialog.innerHTML = `
                <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">${this.escapeHtml(title)}</h3>
                <p style="margin: 0 0 16px 0; color: var(--text-secondary); font-size: 14px;">${this.escapeHtml(message)}</p>
                <input
                    type="text"
                    id="input-dialog-input"
                    style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 14px; margin-bottom: 16px;"
                />
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="input-dialog-cancel" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Cancel</button>
                    <button id="input-dialog-ok" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">OK</button>
                </div>
            `;

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
        });
    }

    /**
     * Show alert dialog (replaces alert)
     */
    showAlert(message) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            min-width: 400px;
            max-width: 500px;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        dialog.innerHTML = `
            <p style="margin: 0 0 16px 0; color: var(--text-primary); font-size: 14px;">${this.escapeHtml(message)}</p>
            <div style="display: flex; justify-content: flex-end;">
                <button id="alert-dialog-ok" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">OK</button>
            </div>
        `;

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
    }

    /**
     * Show confirm dialog (replaces confirm)
     */
    showConfirmDialog(message) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: var(--bg-primary);
                border-radius: var(--radius-xl);
                padding: 24px;
                min-width: 400px;
                max-width: 500px;
                box-shadow: var(--shadow-xl);
                border: 1px solid var(--border-light);
            `;

            dialog.innerHTML = `
                <p style="margin: 0 0 16px 0; color: var(--text-primary); font-size: 14px;">${this.escapeHtml(message)}</p>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="confirm-dialog-cancel" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">Cancel</button>
                    <button id="confirm-dialog-ok" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">OK</button>
                </div>
            `;

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
