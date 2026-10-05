import { templateLoader } from '../templateLoader.js';
import { pushEscapeHandler } from './modalEscape.js';
import { applyEnvButtonColor, createEnvDropdownItem, positionEnvDropdown } from './envDropdown.js';

export class EnvironmentSelector {
    constructor(environmentService, onEnvironmentSwitch, onManageClick) {
        this.service = environmentService;
        this.onEnvironmentSwitch = onEnvironmentSwitch;
        this.onManageClick = onManageClick;
        this.container = null;
        this.dropdown = null;
        this.isOpen = false;
        this.releaseEscape = null;
        this.activeEnvironment = null;
    }

    initialize(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            return;
        }

        this.render();
        this.setupEventListeners();
    }

    render() {
        const fragment = templateLoader.cloneSync(
            './src/templates/environment/environmentSelector.html',
            'tpl-environment-selector'
        );
        this.container.innerHTML = '';
        this.container.appendChild(fragment);

        this.dropdown = this.container.querySelector('#env-selector-dropdown');
    }

    _applyActiveEnvironmentStyle(environment) {
        const button = document.getElementById('env-selector-btn');
        const indicator = this.container?.querySelector('[data-role="active-indicator"]');
        if (!button || !indicator) {
            return;
        }

        applyEnvButtonColor(button, indicator, environment?.color);
    }

    setupEventListeners() {
        const button = document.getElementById('env-selector-btn');

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });
    }

    async toggleDropdown() {
        if (this.isOpen) {
            this.closeDropdown();
        } else {
            await this.openDropdown();
        }
    }

    async openDropdown() {
        try {
            const environments = await this.service.getAllEnvironments();
            const activeEnvId = await this.service.getActiveEnvironmentId();

            this.dropdown.innerHTML = '';

            environments.forEach(env => {
                const item = createEnvDropdownItem(env, env.id === activeEnvId);

                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (env.id !== activeEnvId) {
                        await this.selectEnvironment(env.id);
                    }
                    this.closeDropdown();
                });

                this.dropdown.appendChild(item);
            });

            {
                const separatorFragment = templateLoader.cloneSync(
                    './src/templates/environment/environmentSelector.html',
                    'tpl-env-dropdown-separator'
                );
                this.dropdown.appendChild(separatorFragment);
            }

            const manageFragment = templateLoader.cloneSync(
                './src/templates/environment/environmentSelector.html',
                'tpl-env-manage-item'
            );
            const manageItem = manageFragment.firstElementChild;

            manageItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeDropdown();
                this.onManageClick?.();
            });

            this.dropdown.appendChild(manageItem);

            this.dropdown.classList.remove('is-hidden');
            this.isOpen = true;
            this.releaseEscape = pushEscapeHandler(() => this.closeDropdown());

            this.positionDropdown();
        } catch {}
    }

    closeDropdown() {
        if (this.releaseEscape) {
            this.releaseEscape();
            this.releaseEscape = null;
        }
        if (this.dropdown) {
            this.dropdown.classList.add('is-hidden');
        }
        this.isOpen = false;
    }

    positionDropdown() {
        const button = document.getElementById('env-selector-btn');
        if (!button) {return;}

        positionEnvDropdown(this.dropdown, button);
    }

    async selectEnvironment(environmentId) {
        try {
            await this.onEnvironmentSwitch?.(environmentId);
        } catch {}
    }

    setActiveEnvironment(environment) {
        this.activeEnvironment = environment;
        const nameSpan = document.getElementById('env-selector-name');
        if (nameSpan && environment) {
            nameSpan.textContent = environment.name;
        }
        this._applyActiveEnvironmentStyle(environment);
    }

    async refresh() {
        if (this.isOpen) {
            await this.openDropdown();
        }

        try {
            const activeEnvironment = await this.service.getActiveEnvironment();
            if (activeEnvironment) {
                this.setActiveEnvironment(activeEnvironment);
            }
        } catch {}
    }
}
