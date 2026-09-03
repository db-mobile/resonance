/**
 * @fileoverview Cookie manager dialog UI
 * @module ui/CookieManagerDialog
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';
import { toast } from './Toast.js';
import { pushEscapeHandler } from './modalEscape.js';

export class CookieManagerDialog {
    constructor(cookieJarService, environmentService) {
        this.service = cookieJarService;
        this.environmentService = environmentService;
        this.dialog = null;
        this.resolve = null;
        this.releaseEscape = null;
        this._allCookies = [];
        this._environments = [];
        this._environmentId = 'default';
        this._environmentName = null;
        this._envDropdownOpen = false;
        this._editorOpen = false;
        this._editorOriginalId = null;
    }

    /**
     * Translate a key with an English fallback.
     * @param {string} key - Dot-path i18n key
     * @param {string} fallback - Text used when no translation is available
     * @returns {string} The translated string
     */
    _t(key, fallback) {
        const translated = app.i18n?.t?.(key);
        return translated && translated !== key ? translated : fallback;
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

        app.i18n?.updateUI?.(content);

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
                expiresTd.textContent = this._t('cookies.session', 'Session');
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
            actionTd.className = 'cookie-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-xs btn-outline';
            editBtn.textContent = this._t('cookies.edit', 'Edit');
            editBtn.addEventListener('click', () => {
                this._openEditor(content, cookie);
            });
            actionTd.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-xs btn-outline';
            deleteBtn.textContent = this._t('cookies.delete', 'Delete');
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
            c.domain.toLowerCase().includes(lower) ||
            c.name.toLowerCase().includes(lower) ||
            (!c.httpOnly && c.value.toLowerCase().includes(lower))
        );
        this._render(filtered);
    }

    /**
     * Format an epoch-ms timestamp for the expires field, in local time.
     * @param {number} ms - Epoch milliseconds
     * @returns {string} The value in YYYY-MM-DD HH:mm form
     */
    _formatExpires(ms) {
        const date = new Date(ms);
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
            + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /**
     * Parse what the user typed into the expires field. A bare date or a
     * space-separated time is completed into the ISO local form so it is read
     * as local time rather than UTC; other formats fall back to Date.parse.
     * @param {string} raw - The field's text
     * @returns {number|null} Epoch milliseconds, null for a session cookie, or NaN when unparseable
     */
    _parseExpires(raw) {
        const text = (raw || '').trim();
        if (!text) {
            return null;
        }
        let candidate = text.replace(' ', 'T');
        if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
            candidate += 'T00:00';
        }
        const parsed = Date.parse(candidate);
        return isNaN(parsed) ? Date.parse(text) : parsed;
    }

    /**
     * Open the inline editor, prefilled from `cookie` when editing.
     * @param {Element} content - The dialog content root
     * @param {Object|null} cookie - Cookie being edited, or null to add
     */
    _openEditor(content, cookie = null) {
        const editor = content.querySelector('#cookie-editor');
        const title = content.querySelector('#cookie-editor-title');
        const error = content.querySelector('#cookie-editor-error');

        this._editorOriginalId = cookie?.id || null;
        title.textContent = cookie
            ? this._t('cookies.editor_title_edit', 'Edit Cookie')
            : this._t('cookies.editor_title_add', 'Add Cookie');

        content.querySelector('#cookie-editor-name').value = cookie?.name || '';
        content.querySelector('#cookie-editor-value').value = cookie?.value || '';
        content.querySelector('#cookie-editor-domain').value = cookie?.domain || '';
        content.querySelector('#cookie-editor-path').value = cookie?.path || '/';
        content.querySelector('#cookie-editor-expires').value =
            cookie?.expires ? this._formatExpires(cookie.expires) : '';
        content.querySelector('#cookie-editor-samesite').value = cookie?.sameSite || '';
        content.querySelector('#cookie-editor-secure').checked = Boolean(cookie?.secure);
        content.querySelector('#cookie-editor-httponly').checked = Boolean(cookie?.httpOnly);

        error.classList.add('is-hidden');
        error.textContent = '';
        editor.classList.remove('is-hidden');
        this._editorOpen = true;
        content.querySelector('#cookie-editor-name').focus();
    }

    _closeEditor(content) {
        // Focus must not stay on a field inside a section that is about to be
        // hidden.
        content.querySelector('#cookie-editor-expires')?.blur();
        const editor = content.querySelector('#cookie-editor');
        if (editor) { editor.classList.add('is-hidden'); }
        this._editorOpen = false;
        this._editorOriginalId = null;
    }

    /**
     * Map a validateCookie error code to its localized message.
     * @param {string} code - Validation error code from the service
     * @returns {string} The localized message
     */
    _validationMessage(code) {
        const fallbacks = {
            name_required: 'Cookie name is required',
            name_invalid: 'Cookie name must not contain spaces, ";", "=", or control characters',
            value_invalid: 'Cookie value must not contain ";" or control characters',
            domain_invalid: 'A valid domain is required',
            path_invalid: 'Path must start with "/"',
            expires_invalid: 'Expires must be a valid date or empty for a session cookie'
        };
        return this._t(`cookies.error_${code}`, fallbacks[code] || code);
    }

    _readEditor(content) {
        const expiresRaw = content.querySelector('#cookie-editor-expires').value;
        return {
            name: content.querySelector('#cookie-editor-name').value.trim(),
            value: content.querySelector('#cookie-editor-value').value,
            domain: content.querySelector('#cookie-editor-domain').value.trim(),
            path: content.querySelector('#cookie-editor-path').value.trim() || '/',
            expires: this._parseExpires(expiresRaw),
            sameSite: content.querySelector('#cookie-editor-samesite').value || null,
            secure: content.querySelector('#cookie-editor-secure').checked,
            httpOnly: content.querySelector('#cookie-editor-httponly').checked
        };
    }

    async _saveEditor(content) {
        const error = content.querySelector('#cookie-editor-error');
        const cookie = this._readEditor(content);

        const code = this.service.validateCookie(cookie);
        if (code) {
            error.textContent = this._validationMessage(code);
            error.classList.remove('is-hidden');
            return;
        }

        await this.service.putCookie(cookie, this._environmentId, this._editorOriginalId);
        this._closeEditor(content);
        await this._loadCookies();
        const search = content.querySelector('#cookie-manager-search');
        if (search && search.value.trim()) { this._applySearch(search.value.trim()); }
    }

    async _exportCookies() {
        const cookies = await this.service.getAll(this._environmentId);
        if (cookies.length === 0) {
            toast.info(this._t('cookies.export_empty', 'No cookies to export for this environment'));
            return;
        }
        const content = JSON.stringify(
            { format: 'resonance-cookie-jar', version: 1, cookies },
            null,
            2
        );
        const safeName = (this._environmentName || this._environmentId).replace(/[^a-zA-Z0-9]/g, '_');
        const result = await window.backendAPI.environments.saveJsonExport(`cookies_${safeName}.json`, content);
        if (result?.success) {
            toast.success(this._t('cookies.export_success', 'Cookies exported'));
        }
    }

    async _importCookies() {
        let doc;
        try {
            doc = await window.backendAPI.cookies.importCookieFile();
        } catch (error) {
            toast.error(typeof error === 'string' ? error : error.message);
            return;
        }
        if (!doc) { return; }

        if (doc.format !== 'resonance-cookie-jar' || !Array.isArray(doc.cookies)) {
            toast.error(this._t(
                'cookies.import_invalid',
                'Not a Resonance cookie export (expected { "format": "resonance-cookie-jar", "cookies": [...] })'
            ));
            return;
        }

        let imported = 0;
        let skipped = 0;
        for (const entry of doc.cookies) {
            const cookie = {
                name: entry?.name,
                value: entry?.value ?? '',
                domain: entry?.domain,
                path: entry?.path || '/',
                expires: entry?.expires ?? null,
                sameSite: entry?.sameSite || null,
                secure: Boolean(entry?.secure),
                httpOnly: Boolean(entry?.httpOnly),
                hostOnly: Boolean(entry?.hostOnly)
            };
            if (this.service.validateCookie(cookie)) {
                skipped += 1;
                continue;
            }
            await this.service.putCookie(cookie, this._environmentId);
            imported += 1;
        }

        await this._loadCookies();
        const summary = skipped > 0
            ? `${this._t('cookies.import_success', 'Cookies imported')}: ${imported} (${skipped} ${this._t('cookies.import_skipped', 'skipped')})`
            : `${this._t('cookies.import_success', 'Cookies imported')}: ${imported}`;
        toast.success(summary);
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
                } catch (_e) { }
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

        this.releaseEscape = pushEscapeHandler(() => {
            if (this._envDropdownOpen) {
                this._closeEnvDropdown(content);
                return;
            }
            if (this._editorOpen) {
                this._closeEditor(content);
                return;
            }
            close();
        });

        const addBtn = content.querySelector('#cookie-manager-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this._openEditor(content, null));
        }
        const importBtn = content.querySelector('#cookie-manager-import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this._importCookies());
        }
        const exportBtn = content.querySelector('#cookie-manager-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this._exportCookies());
        }
        const editorSaveBtn = content.querySelector('#cookie-editor-save-btn');
        if (editorSaveBtn) {
            editorSaveBtn.addEventListener('click', () => this._saveEditor(content));
        }
        const editorCancelBtn = content.querySelector('#cookie-editor-cancel-btn');
        if (editorCancelBtn) {
            editorCancelBtn.addEventListener('click', () => this._closeEditor(content));
        }

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
        if (this.releaseEscape) {
            this.releaseEscape();
            this.releaseEscape = null;
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
