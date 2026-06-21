/**
 * @fileoverview Cookie manager dialog UI
 * @module ui/CookieManagerDialog
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';

export class CookieManagerDialog {
    constructor(cookieJarService, environmentService) {
        this.service = cookieJarService;
        this.environmentService = environmentService;
        this.dialog = null;
        this.resolve = null;
        this.escapeHandler = null;
        this._allCookies = [];
        this._environments = [];
        this._environmentId = 'default';
        this._environmentName = null;
        this._envDropdownOpen = false;
    }

    show(environmentId, environmentName) {
        this._environmentId = environmentId || 'default';
        this._environmentName = environmentName || null;
        return new Promise((resolve) => {
            this.resolve = resolve;
            this._createDialog();
        });
    }

    async _createDialog() {
        this.dialog = document.createElement('div');
        this.dialog.className = 'cookie-manager-overlay modal-overlay';

        const content = document.createElement('div');
        content.className = 'cookie-manager-dialog modal-dialog modal-dialog--cookie-manager';

        const fragment = templateLoader.cloneSync(
            './src/templates/cookies/cookieManager.html',
            'tpl-cookie-manager'
        );
        content.appendChild(fragment);
        this.dialog.appendChild(content);
        document.body.appendChild(this.dialog);

        await this._populateEnvironments(content);
        await this._loadToggleState(content);
        await this._loadCookies();
        this._setupListeners(content);
    }

    /**
     * Loads the available environments and resolves the initial selection:
     * the active environment, falling back to one named "Default", then to the
     * first available environment.
     */
    async _populateEnvironments(content) {
        const button = content.querySelector('#cookie-manager-env-btn');
        if (!button) { return; }

        try {
            this._environments = await this.environmentService.getAllEnvironments() || [];
        } catch (_e) {
            this._environments = [];
        }

        if (this._environments.length === 0) {
            button.disabled = true;
            this._updateEnvButton(content, this._environmentName || 'No Environment', null);
            return;
        }

        // Resolve initial selection: active env → env named "Default" → first env
        let selected = this._environments.find(env => env.id === this._environmentId);
        if (!selected) {
            selected = this._environments.find(env => env.name === 'Default') || this._environments[0];
        }
        this._environmentId = selected.id;
        this._environmentName = selected.name;
        this._updateEnvButton(content, selected.name, selected.color || null);
    }

    /**
     * Update the selector button label and color highlighting.
     */
    _updateEnvButton(content, name, color) {
        const button = content.querySelector('#cookie-manager-env-btn');
        const nameEl = content.querySelector('#cookie-manager-env-name');
        const indicator = content.querySelector('[data-role="active-indicator"]');
        if (nameEl) { nameEl.textContent = name; }

        const hasColor = Boolean(color);
        if (button) {
            button.classList.toggle('has-color', hasColor);
            if (hasColor) { button.style.setProperty('--env-selected-color', color); }
            else { button.style.removeProperty('--env-selected-color'); }
        }
        if (indicator) {
            indicator.classList.toggle('is-hidden', !hasColor);
            if (hasColor) { indicator.style.setProperty('--env-indicator-color', color); }
            else { indicator.style.removeProperty('--env-indicator-color'); }
        }
    }

    /**
     * Build and open the environment dropdown.
     */
    _openEnvDropdown(content) {
        const dropdown = content.querySelector('#cookie-manager-env-dropdown');
        const button = content.querySelector('#cookie-manager-env-btn');
        if (!dropdown || !button || button.disabled) { return; }

        dropdown.innerHTML = '';

        for (const env of this._environments) {
            const fragment = templateLoader.cloneSync(
                './src/templates/environment/environmentSelector.html',
                'tpl-env-dropdown-item'
            );
            const item = fragment.firstElementChild;
            const isActive = env.id === this._environmentId;
            item.className = `env-dropdown-item dropdown-item${isActive ? ' active is-active' : ''}`;

            const nameEl = item.querySelector('[data-role="name"]');
            const checkEl = item.querySelector('[data-role="check"]');
            const colorEl = item.querySelector('[data-role="color"]');
            if (nameEl) { nameEl.textContent = env.name; }
            if (checkEl) { checkEl.classList.toggle('is-hidden', !isActive); }
            if (colorEl) {
                colorEl.classList.toggle('is-hidden', !env.color);
                if (env.color) { colorEl.style.setProperty('--env-indicator-color', env.color); }
                else { colorEl.style.removeProperty('--env-indicator-color'); }
            }

            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                this._closeEnvDropdown(content);
                if (env.id !== this._environmentId) {
                    await this._selectEnvironment(content, env);
                }
            });

            dropdown.appendChild(item);
        }

        dropdown.classList.remove('is-hidden');
        this._envDropdownOpen = true;
        this._positionEnvDropdown(content);
    }

    _closeEnvDropdown(content) {
        const dropdown = content.querySelector('#cookie-manager-env-dropdown');
        if (dropdown) { dropdown.classList.add('is-hidden'); }
        this._envDropdownOpen = false;
    }

    _positionEnvDropdown(content) {
        const dropdown = content.querySelector('#cookie-manager-env-dropdown');
        const button = content.querySelector('#cookie-manager-env-btn');
        if (!dropdown || !button) { return; }
        const rect = button.getBoundingClientRect();
        dropdown.style.setProperty('--env-dropdown-top', `${rect.bottom + 4}px`);
        dropdown.style.setProperty('--env-dropdown-left', `${rect.left}px`);
        dropdown.style.setProperty('--env-dropdown-min-width', `${rect.width}px`);
    }

    /**
     * Switch the displayed environment and reload its cookies.
     */
    async _selectEnvironment(content, env) {
        this._environmentId = env.id;
        this._environmentName = env.name;
        this._updateEnvButton(content, env.name, env.color || null);
        await this._loadCookies();
        const search = content.querySelector('#cookie-manager-search');
        if (search && search.value.trim()) { this._applySearch(search.value.trim()); }
    }

    async _loadToggleState(content) {
        const toggle = content.querySelector('#cookie-manager-enabled-toggle');
        if (!toggle) { return; }
        try {
            const settings = await window.backendAPI.settings.get();
            toggle.checked = settings.cookieJarEnabled !== false;
        } catch (_e) {
            toggle.checked = true;
        }
    }

    async _loadCookies() {
        this._allCookies = await this.service.getAll(this._environmentId);
        this._render(this._allCookies);
    }

    _render(cookies) {
        const content = this.dialog.querySelector('.cookie-manager-dialog');
        const tbody = content.querySelector('#cookie-manager-tbody');
        const empty = content.querySelector('#cookie-manager-empty');

        tbody.innerHTML = '';

        if (!cookies || cookies.length === 0) {
            empty.style.display = '';
            return;
        }
        empty.style.display = 'none';

        // Group by domain for visual clarity
        const sorted = [...cookies].sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));

        for (const cookie of sorted) {
            const tr = document.createElement('tr');

            const domainTd = document.createElement('td');
            domainTd.className = 'cookie-name';
            domainTd.textContent = cookie.domain;
            tr.appendChild(domainTd);

            const nameTd = document.createElement('td');
            nameTd.textContent = cookie.name;
            tr.appendChild(nameTd);

            const valueTd = document.createElement('td');
            valueTd.className = 'cookie-value';
            valueTd.textContent = cookie.httpOnly ? '••••••' : cookie.value;
            valueTd.title = cookie.httpOnly ? 'HttpOnly — value hidden' : cookie.value;
            tr.appendChild(valueTd);

            const pathTd = document.createElement('td');
            pathTd.textContent = cookie.path || '/';
            tr.appendChild(pathTd);

            const expiresTd = document.createElement('td');
            if (cookie.expires === null) {
                expiresTd.textContent = 'Session';
            } else {
                expiresTd.textContent = new Date(cookie.expires).toLocaleString();
            }
            tr.appendChild(expiresTd);

            const flagsTd = document.createElement('td');
            const flags = [];
            if (cookie.httpOnly) { flags.push('HttpOnly'); }
            if (cookie.secure) { flags.push('Secure'); }
            if (cookie.sameSite) { flags.push(`SameSite=${cookie.sameSite}`); }
            flagsTd.textContent = flags.join(', ') || '-';
            tr.appendChild(flagsTd);

            const actionTd = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-xs btn-outline';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', async () => {
                await this.service.delete(cookie.id);
                await this._loadCookies();
                const search = content.querySelector('#cookie-manager-search');
                if (search && search.value) { this._applySearch(search.value); }
            });
            actionTd.appendChild(deleteBtn);
            tr.appendChild(actionTd);

            tbody.appendChild(tr);
        }
    }

    _applySearch(term) {
        const lower = term.toLowerCase();
        const filtered = this._allCookies.filter(c =>
            c.domain.includes(lower) ||
            c.name.toLowerCase().includes(lower) ||
            (!c.httpOnly && c.value.toLowerCase().includes(lower))
        );
        this._render(filtered);
    }

    _setupListeners(content) {
        const enabledToggle = content.querySelector('#cookie-manager-enabled-toggle');
        if (enabledToggle) {
            enabledToggle.addEventListener('change', async (e) => {
                try {
                    const settings = await window.backendAPI.settings.get();
                    settings.cookieJarEnabled = e.target.checked;
                    await window.backendAPI.settings.set(settings);
                    app.invalidateApiHandlerSettingsCache?.();
                } catch (_e) { /* non-blocking */ }
            });
        }

        const envBtn = content.querySelector('#cookie-manager-env-btn');
        if (envBtn) {
            envBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._envDropdownOpen) { this._closeEnvDropdown(content); }
                else { this._openEnvDropdown(content); }
            });
        }

        const closeBtn = content.querySelector('#cookie-manager-close-btn');
        const clearSessionBtn = content.querySelector('#cookie-manager-clear-session-btn');
        const clearAllBtn = content.querySelector('#cookie-manager-clear-all-btn');
        const searchInput = content.querySelector('#cookie-manager-search');

        const close = () => this._close();

        closeBtn.addEventListener('click', close);

        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) { close(); return; }
            const selector = content.querySelector('.cookie-manager-env-selector');
            if (this._envDropdownOpen && selector && !selector.contains(e.target)) {
                this._closeEnvDropdown(content);
            }
        });

        this.escapeHandler = (e) => {
            if (e.key !== 'Escape') { return; }
            if (this._envDropdownOpen) { this._closeEnvDropdown(content); return; }
            close();
        };
        document.addEventListener('keydown', this.escapeHandler);

        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.trim();
            if (term) {
                this._applySearch(term);
            } else {
                this._render(this._allCookies);
            }
        });

        clearSessionBtn.addEventListener('click', async () => {
            await this.service.deleteSessionCookies(this._environmentId);
            await this._loadCookies();
        });

        clearAllBtn.addEventListener('click', async () => {
            await this.service.deleteAll(this._environmentId);
            await this._loadCookies();
        });
    }

    _close() {
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }
        if (this.dialog) {
            this.dialog.remove();
            this.dialog = null;
        }
        if (this.resolve) {
            this.resolve(true);
            this.resolve = null;
        }
    }
}
