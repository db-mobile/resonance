/**
 * Environment selector dropdown component
 * Displays active environment and allows quick switching
 */
import { templateLoader } from '../templateLoader.js';

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
            return;
        }

        this.render();
        this.setupEventListeners();
    }

    /**
     * Render the selector
     */
    render() {
        const fragment = templateLoader.cloneSync(
            './src/templates/environment/environmentSelector.html',
            'tpl-environment-selector'
        );
        this.container.innerHTML = '';
        this.container.appendChild(fragment);

        this.dropdown = this.container.querySelector('#env-selector-dropdown');
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
                const fragment = templateLoader.cloneSync(
                    './src/templates/environment/environmentSelector.html',
                    'tpl-env-dropdown-item'
                );
                const item = fragment.firstElementChild;
                item.className = `env-dropdown-item${env.id === activeEnvId ? ' active' : ''}`;

                const nameEl = item.querySelector('[data-role="name"]');
                const checkEl = item.querySelector('[data-role="check"]');
                if (nameEl) {nameEl.textContent = env.name;}
                if (checkEl) {checkEl.classList.toggle('is-hidden', env.id !== activeEnvId);}

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
            {
                const separatorFragment = templateLoader.cloneSync(
                    './src/templates/environment/environmentSelector.html',
                    'tpl-env-dropdown-separator'
                );
                this.dropdown.appendChild(separatorFragment);
            }

            // Add manage button
            const manageFragment = templateLoader.cloneSync(
                './src/templates/environment/environmentSelector.html',
                'tpl-env-manage-item'
            );
            const manageItem = manageFragment.firstElementChild;

            manageItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeDropdown();
                if (this.onManageClick) {
                    this.onManageClick();
                }
            });

            this.dropdown.appendChild(manageItem);

            // Show dropdown
            this.dropdown.classList.remove('is-hidden');
            this.isOpen = true;

            // Position dropdown
            this.positionDropdown();
        } catch (error) {
            void error;
        }
    }

    /**
     * Close dropdown
     */
    closeDropdown() {
        if (this.dropdown) {
            this.dropdown.classList.add('is-hidden');
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
        this.dropdown.style.setProperty('--env-dropdown-top', `${rect.bottom + 4}px`);
        this.dropdown.style.setProperty('--env-dropdown-left', `${rect.left}px`);
        this.dropdown.style.setProperty('--env-dropdown-min-width', `${rect.width}px`);
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
            void error;
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
            void error;
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
