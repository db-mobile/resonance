/**
 * @fileoverview Cookie manager dialog UI
 * @module ui/CookieManagerDialog
 */

import { templateLoader } from '../templateLoader.js';

export class CookieManagerDialog {
    constructor(cookieJarService) {
        this.service = cookieJarService;
        this.dialog = null;
        this.resolve = null;
        this.escapeHandler = null;
        this._allCookies = [];
        this._environmentId = 'default';
        this._environmentName = null;
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

        const envName = content.querySelector('.cookie-manager-env-name');
        if (envName) { envName.textContent = this._environmentName || 'No Environment'; }

        await this._loadToggleState(content);
        await this._loadCookies();
        this._setupListeners(content);
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
                    window.invalidateApiHandlerSettingsCache?.();
                } catch (_e) { /* non-blocking */ }
            });
        }

        const closeBtn = content.querySelector('#cookie-manager-close-btn');
        const clearSessionBtn = content.querySelector('#cookie-manager-clear-session-btn');
        const clearAllBtn = content.querySelector('#cookie-manager-clear-all-btn');
        const searchInput = content.querySelector('#cookie-manager-search');

        const close = () => this._close();

        closeBtn.addEventListener('click', close);

        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) { close(); }
        });

        this.escapeHandler = (e) => {
            if (e.key === 'Escape') { close(); }
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
