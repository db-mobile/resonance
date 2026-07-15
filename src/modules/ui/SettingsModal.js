/**
 * @fileoverview Settings dialog (General/Updates/Proxy/Certs).
 * @module ui/SettingsModal
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';

export class SettingsModal {
    constructor(themeManager, i18nManager = null, httpVersionManager = null, timeoutManager = null, proxyController = null, certificateController = null) {
        this.themeManager = themeManager;
        this.i18nManager = i18nManager;
        this.httpVersionManager = httpVersionManager;
        this.timeoutManager = timeoutManager;
        this.proxyController = proxyController;
        this.certificateController = certificateController;
        this.isOpen = false;
    }

    async show() {
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
            } catch (error) {
                void error;
            }
        }

        const firstSelect = modal.querySelector('select[name="theme"]');
        if (firstSelect) {firstSelect.focus();}
    }

    async createModal() {
        const fragment = templateLoader.cloneSync(
            './src/templates/settings/settingsModal.html',
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
        } catch (e) {
            void e;
        }

        const themeSelect = overlay.querySelector('select[name="theme"]');
        if (themeSelect) {
            themeSelect.value = this.themeManager.getCurrentTheme();
        }

        const httpVersionSelect = overlay.querySelector('select[name="httpVersion"]');
        if (httpVersionSelect) {
            httpVersionSelect.value = currentHttpVersion;
        }

        const timeoutInput = overlay.querySelector('input[name="requestTimeout"]');
        if (timeoutInput) {
            timeoutInput.value = currentTimeout;
        }

        const verifySslCheckbox = overlay.querySelector('input[name="verifySsl"]');
        if (verifySslCheckbox) {
            verifySslCheckbox.checked = currentVerifySsl;
        }

        const followRedirectsCheckbox = overlay.querySelector('input[name="followRedirects"]');
        if (followRedirectsCheckbox) {
            followRedirectsCheckbox.checked = currentFollowRedirects;
        }

        const historyLimitInput = overlay.querySelector('input[name="historyLimit"]');
        if (historyLimitInput) {
            historyLimitInput.value = currentHistoryLimit;
        }

        const checkUpdatesOnLaunchCheckbox = overlay.querySelector('input[name="checkUpdatesOnLaunch"]');
        if (checkUpdatesOnLaunchCheckbox) {
            checkUpdatesOnLaunchCheckbox.checked = currentCheckUpdatesOnLaunch;
        }

        const currentVersionSpan = overlay.querySelector('#settings-current-version');
        if (currentVersionSpan && window.backendAPI?.app?.getVersion) {
            window.backendAPI.app.getVersion().then(version => {
                currentVersionSpan.textContent = version;
            }).catch(() => {
                currentVersionSpan.textContent = 'Unknown';
            });
        }

        if (this.i18nManager) {
            const languagePlaceholder = overlay.querySelector('[data-role="language-section"]');
            if (languagePlaceholder) {
                const langSection = this.createLanguageSectionDOM();
                languagePlaceholder.replaceWith(langSection);
            }
        } else {
            const languagePlaceholder = overlay.querySelector('[data-role="language-section"]');
            if (languagePlaceholder) {
                languagePlaceholder.remove();
            }
        }

        const accentGrid = overlay.querySelector('[data-role="accent-grid"]');
        if (accentGrid) {
            this.createAccentButtonsDOM(accentGrid);
        }

        if (this.proxyController) {
            const tabsContainer = overlay.querySelector('.settings-tabs');
            const proxyTabFragment = templateLoader.cloneSync(
                './src/templates/settings/settingsModal.html',
                'tpl-settings-proxy-tab'
            );
            tabsContainer.appendChild(proxyTabFragment);

            const contentContainer = overlay.querySelector('.settings-content');
            const proxyContentFragment = templateLoader.cloneSync(
                './src/templates/settings/settingsModal.html',
                'tpl-settings-proxy-content'
            );
            const proxyContent = proxyContentFragment.firstElementChild;
            const proxySection = await this.createProxySectionDOM();
            proxyContent.appendChild(proxySection);
            contentContainer.appendChild(proxyContent);
        }

        if (this.certificateController) {
            const tabsContainer = overlay.querySelector('.settings-tabs');
            const certsTabFragment = templateLoader.cloneSync(
                './src/templates/settings/settingsModal.html',
                'tpl-settings-certs-tab'
            );
            tabsContainer.appendChild(certsTabFragment);

            const contentContainer = overlay.querySelector('.settings-content');
            const certsContentFragment = templateLoader.cloneSync(
                './src/templates/settings/settingsModal.html',
                'tpl-settings-certs-content'
            );
            const certsContent = certsContentFragment.firstElementChild;
            const certsSection = await this.createCertsSectionDOM();
            certsContent.appendChild(certsSection);
            contentContainer.appendChild(certsContent);
        }

        const tabsContainer = overlay.querySelector('.settings-tabs');
        const updatesTabFragment = templateLoader.cloneSync(
            './src/templates/settings/settingsModal.html',
            'tpl-settings-updates-tab'
        );
        tabsContainer.appendChild(updatesTabFragment);

        this.attachEventListeners(overlay);
        return overlay;
    }

    createLanguageSectionDOM() {
        const fragment = templateLoader.cloneSync(
            './src/templates/settings/settingsModal.html',
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
            './src/templates/settings/settingsModal.html',
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
            './src/templates/settings/settingsModal.html',
            'tpl-certs-section'
        );
        const section = fragment.firstElementChild;
        this._certsListEl = section.querySelector('[data-role="certs-list"]');

        let items = [];
        try {
            items = await this.certificateController.getItems();
        } catch (error) {
            void error;
        }

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
            './src/templates/settings/settingsModal.html',
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
                } catch (error) {
                    void error;
                }
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

    _validateRow(row) {
        const errorEl = row.querySelector('[data-role="cert-error"]');
        if (!errorEl || !this.certificateController) {
            return;
        }
        const errors = this.certificateController.validateEntry({
            host: row.querySelector('input[name="certHost"]').value,
            certPath: row.querySelector('input[name="certCertPath"]').value,
            keyPath: row.querySelector('input[name="certKeyPath"]').value,
            caPath: row.querySelector('input[name="certCaPath"]').value
        });
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
        return Array.from(this._certsListEl.querySelectorAll('.cert-entry')).map(row => ({
            host: row.querySelector('input[name="certHost"]').value.trim(),
            certPath: row.querySelector('input[name="certCertPath"]').value.trim(),
            keyPath: row.querySelector('input[name="certKeyPath"]').value.trim(),
            caPath: row.querySelector('input[name="certCaPath"]').value.trim(),
            enabled: row.querySelector('input[name="certEnabled"]').checked
        }));
    }

    async _saveCerts() {
        if (!this.certificateController) {
            return;
        }
        try {
            await this.certificateController.saveItems(this._collectCertItems());
        } catch (error) {
            void error;
        }
    }

    _updateCertsEmpty(section) {
        const emptyEl = section.querySelector('[data-role="certs-empty"]');
        const hasRows = Boolean(this._certsListEl?.querySelector('.cert-entry'));
        if (emptyEl) {
            emptyEl.classList.toggle('is-hidden', hasRows);
        }
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

        const verifySslCheckbox = overlay.querySelector('input[name="verifySsl"]');
        if (verifySslCheckbox) {
            verifySslCheckbox.addEventListener('change', async (e) => {
                try {
                    const settings = await window.backendAPI.settings.get();
                    settings.verifySsl = e.target.checked;
                    await window.backendAPI.settings.set(settings);
                    app.invalidateApiHandlerSettingsCache?.();
                } catch (err) {
                    void err;
                }
            });
        }

        const followRedirectsCheckbox = overlay.querySelector('input[name="followRedirects"]');
        if (followRedirectsCheckbox) {
            followRedirectsCheckbox.addEventListener('change', async (e) => {
                try {
                    const settings = await window.backendAPI.settings.get();
                    settings.followRedirects = e.target.checked;
                    await window.backendAPI.settings.set(settings);
                    app.invalidateApiHandlerSettingsCache?.();
                } catch (err) {
                    void err;
                }
            });
        }

        const historyLimitInput = overlay.querySelector('input[name="historyLimit"]');
        if (historyLimitInput) {
            historyLimitInput.addEventListener('change', async (e) => {
                const limit = parseInt(e.target.value, 10);
                if (!isNaN(limit) && limit >= 10) {
                    try {
                        const settings = await window.backendAPI.settings.get();
                        settings.historyLimit = limit;
                        await window.backendAPI.settings.set(settings);
                    } catch (err) {
                        void err;
                    }
                }
            });
        }

        const checkUpdatesOnLaunchCheckbox = overlay.querySelector('input[name="checkUpdatesOnLaunch"]');
        if (checkUpdatesOnLaunchCheckbox) {
            checkUpdatesOnLaunchCheckbox.addEventListener('change', async (e) => {
                try {
                    const settings = await window.backendAPI.settings.get();
                    settings.checkUpdatesOnLaunch = e.target.checked;
                    await window.backendAPI.settings.set(settings);
                } catch (err) {
                    void err;
                }
            });
        }

        if (this.proxyController) {
            this.attachProxyEventListeners(overlay);
        }

        const checkUpdatesBtn = overlay.querySelector('#check-for-updates-btn');
        const updateStatus = overlay.querySelector('#update-status');
        const autoUpdateSection = overlay.querySelector('[data-tab-content="updates"] .settings-section:first-child');
        const manualUpdateSection = overlay.querySelector('[data-tab-content="updates"] .settings-section:nth-child(2)');
        if (checkUpdatesBtn && updateStatus) {
            (async () => {
                try {
                    if (window.backendAPI?.updater?.getInstallInfo) {
                        const installInfo = await window.backendAPI.updater.getInstallInfo();
                        if (installInfo.autoUpdateSupported) {
                            return;
                        }
                        if (autoUpdateSection) {
                            autoUpdateSection.style.display = 'none';
                        }
                        if (manualUpdateSection) {
                            manualUpdateSection.style.display = 'none';
                        }
                        const versionSection = overlay.querySelector('[data-tab-content="updates"] .settings-section:last-child');
                        if (!versionSection) {
                            return;
                        }
                        const messageH3 = document.createElement('h3');
                        messageH3.textContent = installInfo.message || app.i18n?.t('settings.updates_managed_externally') || 'Updates are managed by your package manager';
                        const versionH3 = versionSection.querySelector('h3');
                        if (versionH3) {
                            versionH3.className = 'form-input-hint';
                            versionH3.style.marginTop = '16px';
                        }
                        versionSection.insertBefore(messageH3, versionSection.firstChild);
                    }
                } catch (e) {
                }
            })();

            checkUpdatesBtn.addEventListener('click', async () => {
                checkUpdatesBtn.disabled = true;
                updateStatus.textContent = app.i18n?.t('settings.checking_updates') || 'Checking...';
                updateStatus.className = 'update-status';

                try {
                    if (!window.backendAPI?.updater?.check) {
                        updateStatus.textContent = app.i18n?.t('settings.updates_not_available') || 'Updates not available in this build';
                        updateStatus.className = 'update-status info';
                        return;
                    }

                    const update = await window.backendAPI.updater.check();
                    
                    if (update?.available) {
                        updateStatus.textContent = app.i18n?.t('settings.update_available', { version: update.version }) || `Update available: v${update.version}`;
                        updateStatus.className = 'update-status success';
                        
                        const installBtn = document.createElement('button');
                        installBtn.className = 'btn btn-primary btn-sm';
                        installBtn.style.marginLeft = '8px';
                        installBtn.textContent = app.i18n?.t('settings.install_update') || 'Install & Restart';
                        installBtn.addEventListener('click', async () => {
                            installBtn.disabled = true;
                            installBtn.remove();
                            updateStatus.textContent = app.i18n?.t('settings.downloading_update') || 'Downloading...';
                            try {
                                await window.backendAPI.updater.downloadAndInstall(update);
                                updateStatus.textContent = app.i18n?.t('settings.update_installed') || 'Update installed! Restart to apply.';
                                updateStatus.className = 'update-status success';
                            } catch (err) {
                                const errMsg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
                                updateStatus.textContent = `Error: ${errMsg}`;
                                updateStatus.className = 'update-status error';
                            }
                        });
                        updateStatus.appendChild(installBtn);
                    } else {
                        updateStatus.textContent = app.i18n?.t('settings.up_to_date') || 'You are up to date!';
                        updateStatus.className = 'update-status success';
                    }
                } catch (error) {
                    const errorMsg = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
                    updateStatus.textContent = `Error: ${errorMsg}`;
                    updateStatus.className = 'update-status error';
                } finally {
                    checkUpdatesBtn.disabled = false;
                }
            });
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide(overlay);
            }
        });

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.hide(overlay);
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
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
        } catch (error) {
            void error;
        }
    }

    hide(overlay) {
        if (!this.isOpen) {return;}

        this.isOpen = false;
        overlay.remove();
    }
}
