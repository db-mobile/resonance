/**
 * Environment selector dropdown component
 * Displays active environment and allows quick switching
 */
export class EnvironmentSelector {
    constructor(environmentService, onEnvironmentSwitch, onManageClick) {
        this.service = environmentService;
        this.onEnvironmentSwitch = onEnvironmentSwitch;
        this.onManageClick = onManageClick;
        this.container = null;
        this.dropdown = null;
        this.isOpen = false;
        this.activeEnvironment = null;
    }

    /**
     * Initialize selector with container element
     */
    initialize(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Environment selector container ${containerId} not found`);
            return;
        }

        this.render();
        this.setupEventListeners();
    }

    /**
     * Render the selector
     */
    render() {
        this.container.innerHTML = `
            <div class="environment-selector">
                <button id="env-selector-btn" class="env-selector-button">
                    <svg class="env-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="2" y1="12" x2="22" y2="12"></line>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                    </svg>
                    <span id="env-selector-name" class="env-name">Loading...</span>
                    <svg class="env-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
                <div id="env-selector-dropdown" class="env-dropdown" style="display: none;"></div>
            </div>
        `;

        this.dropdown = document.getElementById('env-selector-dropdown');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const button = document.getElementById('env-selector-btn');

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });

        // Close dropdown on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeDropdown();
            }
        });
    }

    /**
     * Toggle dropdown
     */
    async toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            await this.openDropdown();
        }
    }

    /**
     * Open dropdown
     */
    async openDropdown() {
        try {
            const environments = await this.service.getAllEnvironments();
            const activeEnvId = await this.service.getActiveEnvironmentId();

            this.dropdown.innerHTML = '';

            // Add environments
            environments.forEach(env => {
                const item = document.createElement('div');
                item.className = `env-dropdown-item${  env.id === activeEnvId ? ' active' : ''}`;
                item.innerHTML = `
                    <span class="env-dropdown-name">${this.escapeHtml(env.name)}</span>
                    ${env.id === activeEnvId ? '<svg class="env-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                `;

                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (env.id !== activeEnvId) {
                        await this.selectEnvironment(env.id);
                    }
                    this.closeDropdown();
                });

                this.dropdown.appendChild(item);
            });

            // Add separator
            const separator = document.createElement('div');
            separator.className = 'env-dropdown-separator';
            this.dropdown.appendChild(separator);

            // Add manage button
            const manageItem = document.createElement('div');
            manageItem.className = 'env-dropdown-item env-manage-item';
            manageItem.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span class="env-dropdown-name">Manage Environments...</span>
            `;

            manageItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeDropdown();
                if (this.onManageClick) {
                    this.onManageClick();
                }
            });

            this.dropdown.appendChild(manageItem);

            // Show dropdown
            this.dropdown.style.display = 'block';
            this.isOpen = true;

            // Position dropdown
            this.positionDropdown();
        } catch (error) {
            console.error('Error opening environment dropdown:', error);
        }
    }

    /**
     * Close dropdown
     */
    closeDropdown() {
        if (this.dropdown) {
            this.dropdown.style.display = 'none';
        }
        this.isOpen = false;
    }

    /**
     * Position dropdown relative to button
     */
    positionDropdown() {
        const button = document.getElementById('env-selector-btn');
        if (!button) {return;}

        const rect = button.getBoundingClientRect();
        this.dropdown.style.top = `${rect.bottom + 4}px`;
        this.dropdown.style.left = `${rect.left}px`;
        this.dropdown.style.minWidth = `${rect.width}px`;
    }

    /**
     * Select environment
     */
    async selectEnvironment(environmentId) {
        try {
            if (this.onEnvironmentSwitch) {
                await this.onEnvironmentSwitch(environmentId);
            }
        } catch (error) {
            console.error('Error selecting environment:', error);
        }
    }

    /**
     * Set active environment display
     */
    setActiveEnvironment(environment) {
        this.activeEnvironment = environment;
        const nameSpan = document.getElementById('env-selector-name');
        if (nameSpan && environment) {
            nameSpan.textContent = environment.name;
        }
    }

    /**
     * Refresh dropdown content
     */
    async refresh() {
        if (this.isOpen) {
            await this.openDropdown();
        }

        // Refresh active environment display
        try {
            const activeEnvironment = await this.service.getActiveEnvironment();
            if (activeEnvironment) {
                this.setActiveEnvironment(activeEnvironment);
            }
        } catch (error) {
            console.error('Error refreshing environment selector:', error);
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
}
