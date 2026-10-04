/**
 * @fileoverview Settings dialog (General/Updates/Proxy/Certs).
 * @module ui/SettingsModal
 */

import { templateLoader } from '../templateLoader.js';
import { pushEscapeHandler } from './modalEscape.js';
import { updateSetting } from '../state/settingsCache.js';
import { translate } from '../utils/translate.js';

const TEMPLATE_PATH = './src/templates/settings/settingsModal.html';

/**
 * @param {*} error
 * @returns {string}
 */
function formatUpdateError(error) {
    return typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
}

export class SettingsModal {
    constructor(themeManager, i18nManager = null, httpVersionManager = null, timeoutManager = null, proxyController = null, certificateController = null, layoutManager = null) {
        this.themeManager = themeManager;
        this.layoutManager = layoutManager;
        this.i18nManager = i18nManager;
        this.httpVersionManager = httpVersionManager;
        this.timeoutManager = timeoutManager;
        this.proxyController = proxyController;
        this.certificateController = certificateController;
        this.isOpen = false;
    }

    /**
     * @param {{tab?: string}} [options]
     */
    async show({ tab = null } = {}) {
        if (this.isOpen) {return;}

        this.isOpen = true;
        let modal;
        try {
            modal = await this.createModal();
        } catch (error) {
            this.isOpen = false;
            throw error;
        }
        document.body.appendChild(modal);

        const appVersionDisplay = modal.querySelector('#settings-app-version');
        if (appVersionDisplay) {
            try {
                const version = await window.backendAPI?.app?.getVersion?.();
                if (version) {
                    appVersionDisplay.textContent = `v${version}`;
                }
            } catch {}
        }

        const tabButton = tab ? modal.querySelector(`.settings-tab[data-tab="${tab}"]`) : null;
        if (tabButton) {
            tabButton.click();
            tabButton.focus();
            return;
        }

        const firstSelect = modal.querySelector('select[name="theme"]');
        if (firstSelect) {firstSelect.focus();}
    }

    async createModal() {
        const fragment = templateLoader.cloneSync(
            TEMPLATE_PATH,
            'tpl-settings-modal'
        );
        const overlay = fragment.firstElementChild;

        const currentHttpVersion = this.httpVersionManager ? await this.httpVersionManager.getCurrentVersion() : 'auto';
        const currentTimeout = this.timeoutManager ? this.timeoutManager.getCurrentTimeout() : 0;

        let currentVerifySsl = true;
        let currentFollowRedirects = true;
        let currentHistoryLimit = 100;
        let currentCheckUpdatesOnLaunch = false;
        try {
            const settings = await window.backendAPI.settings.get();
            currentVerifySsl = settings.verifySsl !== false;
            currentFollowRedirects = settings.followRedirects !== false;
            currentHistoryLimit = settings.historyLimit || 100;
            currentCheckUpdatesOnLaunch = settings.checkUpdatesOnLaunch === true;
        } catch {}

        this._populateGeneralFields(overlay, {
            httpVersion: currentHttpVersion,
            timeout: currentTimeout,
            verifySsl: currentVerifySsl,
            followRedirects: currentFollowRedirects,
            historyLimit: currentHistoryLimit,
            checkUpdatesOnLaunch: currentCheckUpdatesOnLaunch
        });

        const currentVersionSpan = overlay.querySelector('#settings-current-version');
        if (currentVersionSpan && window.backendAPI?.app?.getVersion) {
            window.backendAPI.app.getVersion().then(version => {
                currentVersionSpan.textContent = version;
            }).catch(() => {
                currentVersionSpan.textContent = 'Unknown';
            });
        }

        const languagePlaceholder = overlay.querySelector('[data-role="language-section"]');
        if (languagePlaceholder && this.i18nManager) {
            languagePlaceholder.replaceWith(this.createLanguageSectionDOM());
        } else if (languagePlaceholder) {
            languagePlaceholder.remove();
        }

        const accentGrid = overlay.querySelector('[data-role="accent-grid"]');
        if (accentGrid) {
            this.createAccentButtonsDOM(accentGrid);
        }

        if (this.proxyController) {
            this._appendOptionalTab(overlay, 'tpl-settings-proxy-tab', 'tpl-settings-proxy-content', await this.createProxySectionDOM());
        }

        if (this.certificateController) {
            this._appendOptionalTab(overlay, 'tpl-settings-certs-tab', 'tpl-settings-certs-content', await this.createCertsSectionDOM());
        }

        overlay.querySelector('.settings-tabs').appendChild(templateLoader.cloneSync(TEMPLATE_PATH, 'tpl-settings-updates-tab'));

        this.i18nManager?.updateUI(overlay);
        this.attachEventListeners(overlay);
        return overlay;
    }

    /**
     * @param {HTMLElement} overlay
     * @param {{httpVersion: string, timeout: number, verifySsl: boolean, followRedirects: boolean, historyLimit: number, checkUpdatesOnLaunch: boolean}} current
     * @returns {void}
     */
    _populateGeneralFields(overlay, current) {
        const fields = [
            ['select[name="theme"]', 'value', () => this.themeManager.getCurrentTheme()],
            ['select[name="layout"]', 'value', () => this.layoutManager?.getLayout()],
            ['select[name="httpVersion"]', 'value', () => current.httpVersion],
            ['input[name="requestTimeout"]', 'value', () => current.timeout],
            ['input[name="verifySsl"]', 'checked', () => current.verifySsl],
            ['input[name="followRedirects"]', 'checked', () => current.followRedirects],
            ['input[name="historyLimit"]', 'value', () => current.historyLimit],
            ['input[name="checkUpdatesOnLaunch"]', 'checked', () => current.checkUpdatesOnLaunch]
        ];
        for (const [selector, property, read] of fields) {
            const field = overlay.querySelector(selector);
            if (!field) {
                continue;
            }
            const value = read();
            if (value !== undefined) {
                field[property] = value;
            }
        }
    }

    /**
     * @param {HTMLElement} overlay
     * @param {string} tabTemplateId
     * @param {string} contentTemplateId
     * @param {HTMLElement} section
     * @returns {void}
     */
    _appendOptionalTab(overlay, tabTemplateId, contentTemplateId, section) {
        overlay.querySelector('.settings-tabs').appendChild(templateLoader.cloneSync(TEMPLATE_PATH, tabTemplateId));

        const content = templateLoader.cloneSync(TEMPLATE_PATH, contentTemplateId).firstElementChild;
        content.appendChild(section);
        overlay.querySelector('.settings-content').appendChild(content);
    }

    createLanguageSectionDOM() {
        const fragment = templateLoader.cloneSync(
            TEMPLATE_PATH,
            'tpl-language-section'
        );
        const section = fragment.firstElementChild;

        const languages = this.i18nManager.getSupportedLanguages();
        const currentLanguage = this.i18nManager.getCurrentLanguage();
        const select = section.querySelector('select[name="language"]');

        Object.entries(languages).forEach(([code, name]) => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = name;
            if (currentLanguage === code) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        return section;
    }

    createAccentButtonsDOM(container) {
        const accents = this.themeManager.getAvailableAccents();
        const currentAccent = this.themeManager.getAccent();

        const accentColors = {
            green: '#3a944a',
            teal: '#2190a4',
            blue: '#3584e4',
            indigo: '#5261c9',
            purple: '#9141ac',
            yellow: '#c88800',
            orange: '#ed5b00',
            red: '#e62d42',
            pink: '#d56199'
        };

        accents.forEach(accent => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'accent-btn';
            if (accent === currentAccent) {
                btn.classList.add('active');
            }
            btn.dataset.accent = accent;
            btn.dataset.btnColor = accentColors[accent];
            btn.setAttribute('aria-label', `${accent} accent color`);
            btn.title = accent.charAt(0).toUpperCase() + accent.slice(1);
            container.appendChild(btn);
        });
    }

    async createProxySectionDOM() {
        const fragment = templateLoader.cloneSync(
            TEMPLATE_PATH,
            'tpl-proxy-section'
        );
        const section = fragment.firstElementChild;

        const settings = await this.proxyController.getSettings();

        const enabledCheckbox = section.querySelector('input[name="proxyEnabled"]');
        if (enabledCheckbox && settings.enabled) {
            enabledCheckbox.checked = true;
        }

        const proxyContent = section.querySelector('.proxy-settings-content');
        if (proxyContent && settings.enabled) {
            proxyContent.classList.remove('is-hidden');
        }

        const useSystemCheckbox = section.querySelector('input[name="proxyUseSystem"]');
        if (useSystemCheckbox && settings.useSystemProxy) {
            useSystemCheckbox.checked = true;
        }

        const manualSettings = section.querySelector('.proxy-manual-settings');
        if (manualSettings && settings.useSystemProxy) {
            manualSettings.classList.add('is-hidden');
        }

        const typeSelect = section.querySelector('select[name="proxyType"]');
        if (typeSelect && settings.type) {
            typeSelect.value = settings.type;
        }

        const hostInput = section.querySelector('input[name="proxyHost"]');
        if (hostInput) {
            hostInput.value = settings.host || '';
        }
        const portInput = section.querySelector('input[name="proxyPort"]');
        if (portInput) {
            portInput.value = settings.port || '';
        }

        const authEnabledCheckbox = section.querySelector('input[name="proxyAuthEnabled"]');
        if (authEnabledCheckbox && settings.auth?.enabled) {
            authEnabledCheckbox.checked = true;
        }

        const authFields = section.querySelector('.proxy-auth-fields');
        if (authFields && settings.auth?.enabled) {
            authFields.classList.remove('is-hidden');
        }

        const usernameInput = section.querySelector('input[name="proxyUsername"]');
        if (usernameInput) {
            usernameInput.value = settings.auth?.username || '';
        }
        const passwordInput = section.querySelector('input[name="proxyPassword"]');
        if (passwordInput) {
            passwordInput.value = settings.auth?.password || '';
        }

        const bypassInput = section.querySelector('input[name="proxyBypass"]');
        if (bypassInput) {
            bypassInput.value = (settings.bypassList || []).join(', ');
        }

        return section;
    }

    async createCertsSectionDOM() {
        const fragment = templateLoader.cloneSync(
            TEMPLATE_PATH,
            'tpl-certs-section'
        );
        const section = fragment.firstElementChild;
        this._certsListEl = section.querySelector('[data-role="certs-list"]');

        let items = [];
        try {
            items = await this.certificateController.getItems();
        } catch {}

        items.forEach(item => this._certsListEl.appendChild(this._renderCertEntry(item)));
        this._updateCertsEmpty(section);

        const addBtn = section.querySelector('[data-role="certs-add"]');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const row = this._renderCertEntry({
                    host: '', certPath: '', keyPath: '', caPath: '', enabled: true
                });
                this._certsListEl.appendChild(row);
                this._updateCertsEmpty(section);
                this.i18nManager?.updateUI(row);
                row.querySelector('input[name="certHost"]')?.focus();
            });
        }

        this.i18nManager?.updateUI(section);
        return section;
    }

    _renderCertEntry(item) {
        const fragment = templateLoader.cloneSync(
            TEMPLATE_PATH,
            'tpl-cert-entry'
        );
        const row = fragment.firstElementChild;

        const host = row.querySelector('input[name="certHost"]');
        const enabled = row.querySelector('input[name="certEnabled"]');
        const pathInputs = {
            cert: row.querySelector('input[name="certCertPath"]'),
            key: row.querySelector('input[name="certKeyPath"]'),
            ca: row.querySelector('input[name="certCaPath"]')
        };

        host.value = item.host || '';
        enabled.checked = item.enabled !== false;
        pathInputs.cert.value = item.certPath || '';
        pathInputs.key.value = item.keyPath || '';
        pathInputs.ca.value = item.caPath || '';

        host.addEventListener('input', () => this._saveCerts());
        enabled.addEventListener('change', () => this._saveCerts());

        row.querySelectorAll('[data-role="cert-pick"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    const pickedPath = await window.backendAPI.certificates.pickFile(btn.dataset.kind);
                    if (pickedPath) {
                        pathInputs[btn.dataset.kind].value = pickedPath;
                        this._validateRow(row);
                        this._saveCerts();
                    }
                } catch {}
            });
        });

        row.querySelectorAll('[data-role="cert-clear"]').forEach(btn => {
            btn.addEventListener('click', () => {
                pathInputs[btn.dataset.kind].value = '';
                this._validateRow(row);
                this._saveCerts();
            });
        });

        row.querySelector('[data-role="cert-remove"]')?.addEventListener('click', () => {
            const section = row.closest('.certs-settings-section');
            row.remove();
            this._saveCerts();
            if (section) {
                this._updateCertsEmpty(section);
            }
        });

        this._validateRow(row);
        return row;
    }

    /**
     * @param {HTMLElement} row
     * @returns {{host: string, certPath: string, keyPath: string, caPath: string}}
     */
    _readCertRow(row) {
        return {
            host: row.querySelector('input[name="certHost"]').value,
            certPath: row.querySelector('input[name="certCertPath"]').value,
            keyPath: row.querySelector('input[name="certKeyPath"]').value,
            caPath: row.querySelector('input[name="certCaPath"]').value
        };
    }

    _validateRow(row) {
        const errorEl = row.querySelector('[data-role="cert-error"]');
        if (!errorEl || !this.certificateController) {
            return;
        }
        const errors = this.certificateController.validateEntry(this._readCertRow(row));
        const pairing = errors.find(e => e.toLowerCase().includes('key file'));
        if (pairing) {
            errorEl.textContent = pairing;
            errorEl.classList.remove('is-hidden');
        } else {
            errorEl.textContent = '';
            errorEl.classList.add('is-hidden');
        }
    }

    _collectCertItems() {
        if (!this._certsListEl) {
            return [];
        }
        return Array.from(this._certsListEl.querySelectorAll('.cert-entry')).map(row => {
            const raw = this._readCertRow(row);
            return {
                host: raw.host.trim(),
                certPath: raw.certPath.trim(),
                keyPath: raw.keyPath.trim(),
                caPath: raw.caPath.trim(),
                enabled: row.querySelector('input[name="certEnabled"]').checked
            };
        });
    }

    async _saveCerts() {
        if (!this.certificateController) {
            return;
        }
        try {
            await this.certificateController.saveItems(this._collectCertItems());
        } catch {}
    }

    _updateCertsEmpty(section) {
        const emptyEl = section.querySelector('[data-role="certs-empty"]');
        const hasRows = Boolean(this._certsListEl?.querySelector('.cert-entry'));
        if (emptyEl) {
            emptyEl.classList.toggle('is-hidden', hasRows);
        }
    }

    /**
     * @param {HTMLElement} overlay
     * @param {string} selector
     * @param {string} key
     * @param {Function} [read]
     * @returns {void}
     */
    _bindSetting(overlay, selector, key, read = (e) => e.target.checked) {
        const input = overlay.querySelector(selector);
        if (!input) {
            return;
        }
        input.addEventListener('change', async (e) => {
            const value = read(e);
            if (value === undefined) {
                return;
            }
            await updateSetting(key, value);
        });
    }

    attachEventListeners(overlay) {
        const closeBtn = overlay.querySelector('.dialog-close-btn');
        const themeSelect = overlay.querySelector('select[name="theme"]');
        const languageSelect = overlay.querySelector('select[name="language"]');
        const httpVersionSelect = overlay.querySelector('select[name="httpVersion"]');
        const timeoutInput = overlay.querySelector('input[name="requestTimeout"]');

        const tabButtons = overlay.querySelectorAll('.settings-tab');
        const tabContents = overlay.querySelectorAll('.settings-tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.dataset.tab;

                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                button.classList.add('active');
                const targetContent = overlay.querySelector(`[data-tab-content="${targetTab}"]`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });

        closeBtn.addEventListener('click', () => this.hide(overlay));

        if (themeSelect) {
            themeSelect.addEventListener('change', async (e) => {
                await this.themeManager.setTheme(e.target.value);
            });
        }

        const layoutSelect = overlay.querySelector('select[name="layout"]');
        if (layoutSelect && this.layoutManager) {
            layoutSelect.addEventListener('change', async (e) => {
                await this.layoutManager.setLayout(e.target.value);
            });
        }

        const accentButtons = overlay.querySelectorAll('.accent-btn');
        accentButtons.forEach(btn => {
            if (btn.dataset.btnColor) {
                btn.style.setProperty('--btn-color', btn.dataset.btnColor);
            }
            btn.addEventListener('click', async () => {
                const { accent } = btn.dataset;
                await this.themeManager.setAccent(accent);

                accentButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        if (this.i18nManager && languageSelect) {
            languageSelect.addEventListener('change', async (e) => {
                await this.i18nManager.setLanguage(e.target.value);
                this.i18nManager.updateUI();
            });
        }

        if (this.httpVersionManager && httpVersionSelect) {
            httpVersionSelect.addEventListener('change', async (e) => {
                await this.httpVersionManager.setVersion(e.target.value);
            });
        }

        if (this.timeoutManager && timeoutInput) {
            timeoutInput.addEventListener('change', async (e) => {
                const timeout = parseInt(e.target.value, 10);
                if (!isNaN(timeout) && timeout >= 0) {
                    await this.timeoutManager.setTimeout(timeout);
                }
            });
        }

        this._bindSetting(overlay, 'input[name="verifySsl"]', 'verifySsl');
        this._bindSetting(overlay, 'input[name="followRedirects"]', 'followRedirects');
        this._bindSetting(overlay, 'input[name="historyLimit"]', 'historyLimit', (e) => {
            const limit = parseInt(e.target.value, 10);
            return !isNaN(limit) && limit >= 10 ? limit : undefined;
        });
        this._bindSetting(overlay, 'input[name="checkUpdatesOnLaunch"]', 'checkUpdatesOnLaunch');

        const checkUpdatesOnLaunchCheckbox = overlay.querySelector('input[name="checkUpdatesOnLaunch"]');

        if (this.proxyController) {
            this.attachProxyEventListeners(overlay);
        }

        this._attachUpdateChecker(overlay, checkUpdatesOnLaunchCheckbox);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide(overlay);
            }
        });

        this._releaseEscape = pushEscapeHandler(() => this.hide(overlay));
    }

    /**
     * @param {HTMLElement} overlay
     * @param {HTMLElement|null} checkUpdatesOnLaunchCheckbox
     * @returns {void}
     */
    _attachUpdateChecker(overlay, checkUpdatesOnLaunchCheckbox) {
        const checkUpdatesBtn = overlay.querySelector('#check-for-updates-btn');
        const updateStatus = overlay.querySelector('#update-status');
        if (!checkUpdatesBtn || !updateStatus) {
            return;
        }

        this._applyInstallInfo(overlay, checkUpdatesBtn, checkUpdatesOnLaunchCheckbox);

        const setStatus = (text, kind = '') => {
            updateStatus.textContent = text;
            updateStatus.className = kind ? `update-status ${kind}` : 'update-status';
        };

        checkUpdatesBtn.addEventListener('click', async () => {
            checkUpdatesBtn.disabled = true;
            setStatus(translate('settings.checking_updates', 'Checking...'));

            try {
                if (!window.backendAPI?.updater?.check) {
                    setStatus(translate('settings.updates_not_available', 'Updates not available in this build'), 'info');
                    return;
                }

                const update = await window.backendAPI.updater.check();

                if (!update?.available) {
                    setStatus(translate('settings.up_to_date', 'You are up to date!'), 'success');
                    return;
                }

                setStatus(translate('settings.update_available', 'Update available: v{{version}}', { version: update.version }), 'success');

                const installBtn = document.createElement('button');
                installBtn.className = 'btn btn-primary btn-sm';
                installBtn.style.marginLeft = '8px';
                installBtn.textContent = translate('settings.install_update', 'Install & Restart');
                installBtn.addEventListener('click', async () => {
                    installBtn.disabled = true;
                    installBtn.remove();
                    setStatus(translate('settings.downloading_update', 'Downloading...'));
                    try {
                        await window.backendAPI.updater.downloadAndInstall(update);
                        setStatus(translate('settings.update_installed', 'Update installed! Restart to apply.'), 'success');
                    } catch (err) {
                        setStatus(`Error: ${formatUpdateError(err)}`, 'error');
                        installBtn.disabled = false;
                        installBtn.textContent = translate('settings.retry_update', 'Retry');
                        updateStatus.appendChild(installBtn);
                    }
                });
                updateStatus.appendChild(installBtn);
            } catch (error) {
                setStatus(`Error: ${formatUpdateError(error)}`, 'error');
            } finally {
                checkUpdatesBtn.disabled = false;
            }
        });
    }

    /**
     * @param {HTMLElement} overlay
     * @param {HTMLElement} checkUpdatesBtn
     * @param {HTMLElement|null} checkUpdatesOnLaunchCheckbox
     * @returns {Promise<void>}
     */
    async _applyInstallInfo(overlay, checkUpdatesBtn, checkUpdatesOnLaunchCheckbox) {
        try {
            if (!window.backendAPI?.updater?.getInstallInfo) {
                return;
            }
            const installInfo = await window.backendAPI.updater.getInstallInfo();
            if (installInfo.autoUpdateSupported) {
                return;
            }
            const autoUpdateRow = checkUpdatesOnLaunchCheckbox?.closest('.row');
            if (autoUpdateRow) {
                autoUpdateRow.style.display = 'none';
            }
            const manualUpdateRow = checkUpdatesBtn.closest('.row');
            if (manualUpdateRow) {
                manualUpdateRow.style.display = 'none';
            }
            const versionRow = overlay.querySelector('#settings-current-version')?.closest('.row');
            if (!versionRow) {
                return;
            }
            const messageRow = document.createElement('div');
            messageRow.className = 'row property';
            const messageContent = document.createElement('div');
            messageContent.className = 'row-content';
            const messageTitle = document.createElement('span');
            messageTitle.className = 'title';
            messageTitle.textContent = installInfo.message || translate('settings.updates_managed_externally', 'Updates are managed by your package manager');
            messageContent.appendChild(messageTitle);
            messageRow.appendChild(messageContent);
            versionRow.parentElement.insertBefore(messageRow, versionRow);
        } catch {}
    }

    attachProxyEventListeners(overlay) {
        const proxyEnabled = overlay.querySelector('input[name="proxyEnabled"]');
        const proxyContent = overlay.querySelector('.proxy-settings-content');
        const proxyUseSystem = overlay.querySelector('input[name="proxyUseSystem"]');
        const proxyManualSettings = overlay.querySelector('.proxy-manual-settings');
        const proxyAuthEnabled = overlay.querySelector('input[name="proxyAuthEnabled"]');
        const proxyAuthFields = overlay.querySelector('.proxy-auth-fields');
        const proxyTestBtn = overlay.querySelector('.proxy-test-btn');
        const proxyTestResult = overlay.querySelector('.proxy-test-result');

        const proxyType = overlay.querySelector('select[name="proxyType"]');
        const proxyHost = overlay.querySelector('input[name="proxyHost"]');
        const proxyPort = overlay.querySelector('input[name="proxyPort"]');
        const proxyUsername = overlay.querySelector('input[name="proxyUsername"]');
        const proxyPassword = overlay.querySelector('input[name="proxyPassword"]');
        const proxyBypass = overlay.querySelector('input[name="proxyBypass"]');

        if (proxyEnabled && proxyContent) {
            proxyEnabled.addEventListener('change', async (e) => {
                proxyContent.classList.toggle('is-hidden', !e.target.checked);
                await this.saveProxySettings(overlay);
            });
        }

        if (proxyUseSystem && proxyManualSettings) {
            proxyUseSystem.addEventListener('change', async (e) => {
                proxyManualSettings.classList.toggle('is-hidden', e.target.checked);
                await this.saveProxySettings(overlay);
            });
        }

        if (proxyAuthEnabled && proxyAuthFields) {
            proxyAuthEnabled.addEventListener('change', async (e) => {
                proxyAuthFields.classList.toggle('is-hidden', !e.target.checked);
                await this.saveProxySettings(overlay);
            });
        }

        const proxyFields = [proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword, proxyBypass];
        proxyFields.forEach(field => {
            if (field) {
                field.addEventListener('change', async () => {
                    await this.saveProxySettings(overlay);
                });
            }
        });

        if (proxyTestBtn && proxyTestResult) {
            proxyTestBtn.addEventListener('click', async () => {
                proxyTestBtn.disabled = true;
                proxyTestBtn.textContent = 'Testing...';
                proxyTestResult.textContent = '';
                proxyTestResult.className = 'proxy-test-result';

                try {
                    await this.saveProxySettings(overlay);

                    const result = await this.proxyController.testConnection();

                    if (result.success) {
                        proxyTestResult.textContent = `✓ ${result.message}`;
                        proxyTestResult.className = 'proxy-test-result success';
                    } else {
                        proxyTestResult.textContent = `✗ ${result.message}`;
                        proxyTestResult.className = 'proxy-test-result error';
                    }
                } catch (error) {
                    proxyTestResult.textContent = `✗ ${error.message}`;
                    proxyTestResult.className = 'proxy-test-result error';
                } finally {
                    proxyTestBtn.disabled = false;
                    proxyTestBtn.textContent = 'Test Connection';
                }
            });
        }
    }

    async saveProxySettings(overlay) {
        if (!this.proxyController) {return;}

        try {
            const enabled = overlay.querySelector('input[name="proxyEnabled"]')?.checked || false;
            const useSystemProxy = overlay.querySelector('input[name="proxyUseSystem"]')?.checked || false;
            const type = overlay.querySelector('select[name="proxyType"]')?.value || 'http';
            const host = overlay.querySelector('input[name="proxyHost"]')?.value || '';
            const port = parseInt(overlay.querySelector('input[name="proxyPort"]')?.value, 10) || 8080;
            const authEnabled = overlay.querySelector('input[name="proxyAuthEnabled"]')?.checked || false;
            const username = overlay.querySelector('input[name="proxyUsername"]')?.value || '';
            const password = overlay.querySelector('input[name="proxyPassword"]')?.value || '';
            const bypassText = overlay.querySelector('input[name="proxyBypass"]')?.value || '';

            const bypassList = bypassText
                .split(',')
                .map(item => item.trim())
                .filter(item => item.length > 0);

            const settings = {
                enabled,
                useSystemProxy,
                type,
                host,
                port,
                auth: {
                    enabled: authEnabled,
                    username,
                    password
                },
                bypassList,
                timeout: 10000
            };

            await this.proxyController.updateSettings(settings);
        } catch {}
    }

    hide(overlay) {
        if (!this.isOpen) {return;}

        this.isOpen = false;
        if (this._releaseEscape) {
            this._releaseEscape();
            this._releaseEscape = null;
        }
        overlay.remove();
    }
}
