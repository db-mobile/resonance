export class ThemeManager {
    constructor() {
        this.currentTheme = 'system';
        this.currentThemeLink = null;
        this.availableThemes = ['light', 'dark', 'system', 'blueprint'];
        this.init();
    }

    async init() {
        await this.loadSavedTheme();
        await this.applyTheme(this.currentTheme);
        this.setupSystemThemeListener();
    }

    async loadSavedTheme() {
        try {
            const savedTheme = await window.electronAPI.store.get('theme');
            this.currentTheme = savedTheme || 'system';
        } catch (error) {
            console.error('Error loading saved theme:', error);
            this.currentTheme = 'system';
        }
    }

    async saveTheme(theme) {
        try {
            await window.electronAPI.store.set('theme', theme);
        } catch (error) {
            console.error('Error saving theme:', error);
        }
    }

    async loadThemeCSS(theme) {
        return new Promise((resolve, reject) => {
            if (this.currentThemeLink) {
                this.currentThemeLink.remove();
                this.currentThemeLink = null;
            }

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `src/themes/${theme}.css`;
            link.id = `theme-${theme}`;
            
            link.onload = () => {
                this.currentThemeLink = link;
                resolve();
            };
            
            link.onerror = () => {
                reject(new Error(`Failed to load theme: ${theme}`));
            };

            document.head.appendChild(link);
        });
    }

    async applyTheme(theme) {
        try {
            await this.loadThemeCSS(theme);
            document.documentElement.setAttribute('data-theme', theme);
            this.currentTheme = theme;
        } catch (error) {
            console.error('Error applying theme:', error);
            if (theme !== 'system') {
                await this.applyTheme('system');
            }
        }
    }

    async setTheme(theme) {
        if (!this.availableThemes.includes(theme)) {
            console.error(`Theme '${theme}' is not available`);
            return;
        }
        
        await this.applyTheme(theme);
        await this.saveTheme(theme);
    }

    setupSystemThemeListener() {
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', async () => {
                if (this.currentTheme === 'system') {
                    await this.applyTheme('system');
                }
            });
        }
    }

    getCurrentTheme() {
        return this.currentTheme;
    }

    getSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    getEffectiveTheme() {
        if (this.currentTheme === 'system') {
            return this.getSystemTheme();
        }
        return this.currentTheme;
    }

    getAvailableThemes() {
        return [...this.availableThemes];
    }

    addTheme(themeName) {
        if (!this.availableThemes.includes(themeName)) {
            this.availableThemes.push(themeName);
        }
    }

    removeTheme(themeName) {
        if (themeName !== 'light' && themeName !== 'dark' && themeName !== 'system') {
            this.availableThemes = this.availableThemes.filter(theme => theme !== themeName);
        }
    }
}

export class SettingsModal {
    constructor(themeManager, i18nManager = null, httpVersionManager = null, timeoutManager = null, proxyController = null) {
        this.themeManager = themeManager;
        this.i18nManager = i18nManager;
        this.httpVersionManager = httpVersionManager;
        this.timeoutManager = timeoutManager;
        this.proxyController = proxyController;
        this.isOpen = false;
    }

    async show() {
        if (this.isOpen) {return;}

        this.isOpen = true;
        const modal = await this.createModal();
        document.body.appendChild(modal);

        const firstSelect = modal.querySelector('select[name="theme"]');
        if (firstSelect) {firstSelect.focus();}
    }

    async createModal() {
        const overlay = document.createElement('div');
        overlay.className = 'settings-modal-overlay';

        const languageSection = this.i18nManager ? this.createLanguageSection() : '';
        const proxySection = this.proxyController ? await this.createProxySection() : '';

        const currentHttpVersion = this.httpVersionManager ? await this.httpVersionManager.getCurrentVersion() : 'auto';
        const currentTimeout = this.timeoutManager ? this.timeoutManager.getCurrentTimeout() : 0;

        // Determine which tabs to show
        const showProxyTab = !!this.proxyController;

        overlay.innerHTML = `
            <div class="settings-modal">
                <div class="settings-header">
                    <h2 data-i18n="settings.title">Settings</h2>
                    <button class="settings-close-btn" aria-label="Close Settings" data-i18n-aria="settings.close">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div class="settings-tabs">
                    <button class="settings-tab active" data-tab="general" data-i18n="settings.tab_general">General</button>
                    ${showProxyTab ? '<button class="settings-tab" data-tab="proxy" data-i18n="settings.tab_proxy">Proxy</button>' : ''}
                </div>

                <div class="settings-content">
                    <div class="settings-tab-content active" data-tab-content="general">
                        ${languageSection}
                        <div class="settings-section">
                            <h3 data-i18n="settings.theme">Theme</h3>
                            <div class="theme-select-container">
                                <select class="theme-select" name="theme">
                                    <option value="light" ${this.themeManager.getCurrentTheme() === 'light' ? 'selected' : ''} data-i18n="theme.light">Light</option>
                                    <option value="dark" ${this.themeManager.getCurrentTheme() === 'dark' ? 'selected' : ''} data-i18n="theme.dark">Dark</option>
                                    <option value="system" ${this.themeManager.getCurrentTheme() === 'system' ? 'selected' : ''} data-i18n="theme.system">System</option>
                                    <option value="blueprint" ${this.themeManager.getCurrentTheme() === 'blueprint' ? 'selected' : ''} data-i18n="theme.blueprint">Blueprint</option>
                                </select>
                                <svg class="select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="2 4 6 8 10 4"></polyline>
                                </svg>
                            </div>
                        </div>
                    
                    <div class="settings-section">
                        <h3 data-i18n="settings.http_version">HTTP Version</h3>
                        <div class="http-version-select-container">
                            <select class="http-version-select" name="httpVersion">
                                <option value="auto" ${currentHttpVersion === 'auto' ? 'selected' : ''} data-i18n="http_version.auto">Auto</option>
                                <option value="http1" ${currentHttpVersion === 'http1' ? 'selected' : ''} data-i18n="http_version.http1">HTTP/1.x</option>
                                <option value="http2" ${currentHttpVersion === 'http2' ? 'selected' : ''} data-i18n="http_version.http2">HTTP/2</option>
                            </select>
                            <svg class="select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="2 4 6 8 10 4"></polyline>
                            </svg>
                        </div>
                    </div>

                        <div class="settings-section">
                            <h3 data-i18n="settings.request_timeout">Request Timeout</h3>
                            <div class="form-input-container">
                                <input type="number" class="form-input" name="requestTimeout"
                                       value="${currentTimeout}"
                                       min="0"
                                       step="1000"
                                       placeholder="0">
                                <span class="form-input-unit">ms</span>
                            </div>
                            <p class="form-input-hint" data-i18n="settings.timeout_description">Set to 0 for no timeout</p>
                        </div>
                    </div>

                    ${showProxyTab ? `<div class="settings-tab-content" data-tab-content="proxy">${proxySection}</div>` : ''}
                </div>
            </div>
        `;

        this.attachEventListeners(overlay);
        return overlay;
    }

    createLanguageSection() {
        if (!this.i18nManager) {return '';}

        const languages = this.i18nManager.getSupportedLanguages();
        const currentLanguage = this.i18nManager.getCurrentLanguage();

        const languageOptions = Object.entries(languages).map(([code, name]) => `
            <option value="${code}" ${currentLanguage === code ? 'selected' : ''}>${name}</option>
        `).join('');

        return `
            <div class="settings-section">
                <h3 data-i18n="settings.language">Language</h3>
                <div class="language-select-container">
                    <select class="language-select" name="language">
                        ${languageOptions}
                    </select>
                    <svg class="select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="2 4 6 8 10 4"></polyline>
                    </svg>
                </div>
            </div>
        `;
    }

    async createProxySection() {
        if (!this.proxyController) {return '';}

        const settings = await this.proxyController.getSettings();

        return `
            <div class="settings-section proxy-settings-section">
                <div class="settings-section-header">
                    <label class="proxy-toggle">
                        <input type="checkbox" name="proxyEnabled" ${settings.enabled ? 'checked' : ''}>
                        <span data-i18n="settings.proxy_enabled">Enable Proxy</span>
                    </label>
                </div>

                <div class="proxy-settings-content" style="display: ${settings.enabled ? 'block' : 'none'}">
                    <div class="proxy-row">
                        <label class="proxy-system-toggle">
                            <input type="checkbox" name="proxyUseSystem" ${settings.useSystemProxy ? 'checked' : ''}>
                            <span data-i18n="settings.proxy_use_system">Use System Proxy</span>
                        </label>
                        <p class="proxy-field-help" data-i18n="settings.proxy_use_system_help">Automatically detect and use system proxy settings</p>
                    </div>

                    <div class="proxy-manual-settings" style="display: ${settings.useSystemProxy ? 'none' : 'block'}">
                        <div class="proxy-row">
                            <div class="proxy-field proxy-field-with-arrow">
                                <label data-i18n="settings.proxy_type">Type</label>
                                <div class="select-wrapper">
                                    <select name="proxyType" class="proxy-type-select">
                                        <option value="http" ${settings.type === 'http' ? 'selected' : ''}>HTTP</option>
                                        <option value="https" ${settings.type === 'https' ? 'selected' : ''}>HTTPS</option>
                                        <option value="socks4" ${settings.type === 'socks4' ? 'selected' : ''}>SOCKS4</option>
                                        <option value="socks5" ${settings.type === 'socks5' ? 'selected' : ''}>SOCKS5</option>
                                    </select>
                                    <svg class="select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="2 4 6 8 10 4"></polyline>
                                    </svg>
                                </div>
                            </div>
                        </div>

                    <div class="proxy-row">
                        <div class="proxy-field proxy-field-grow">
                            <label data-i18n="settings.proxy_host">Host</label>
                            <input type="text" name="proxyHost" value="${settings.host || ''}" placeholder="proxy.example.com">
                        </div>
                        <div class="proxy-field proxy-field-port">
                            <label data-i18n="settings.proxy_port">Port</label>
                            <input type="number" name="proxyPort" value="${settings.port}" min="1" max="65535">
                        </div>
                    </div>

                    <div class="proxy-row">
                        <label class="proxy-auth-toggle">
                            <input type="checkbox" name="proxyAuthEnabled" ${settings.auth?.enabled ? 'checked' : ''}>
                            <span data-i18n="settings.proxy_auth">Authentication</span>
                        </label>
                    </div>

                    <div class="proxy-auth-fields" style="display: ${settings.auth?.enabled ? 'block' : 'none'}">
                        <div class="proxy-row">
                            <div class="proxy-field proxy-field-grow">
                                <label data-i18n="settings.proxy_username">Username</label>
                                <input type="text" name="proxyUsername" value="${settings.auth?.username || ''}" autocomplete="off">
                            </div>
                        </div>
                        <div class="proxy-row">
                            <div class="proxy-field proxy-field-grow">
                                <label data-i18n="settings.proxy_password">Password</label>
                                <input type="password" name="proxyPassword" value="${settings.auth?.password || ''}" autocomplete="off">
                            </div>
                        </div>
                    </div>

                        <div class="proxy-row">
                            <div class="proxy-field proxy-field-grow">
                                <label data-i18n="settings.proxy_bypass">Bypass List (comma-separated)</label>
                                <input type="text" name="proxyBypass" value="${(settings.bypassList || []).join(', ')}"
                                       placeholder="localhost, *.internal.com">
                                <p class="proxy-field-help">Domains to bypass proxy (supports wildcards: *.example.com)</p>
                            </div>
                        </div>
                    </div>

                    <div class="proxy-row proxy-actions">
                        <button type="button" class="proxy-test-btn" data-i18n="settings.proxy_test">Test Connection</button>
                        <span class="proxy-test-result"></span>
                    </div>
                </div>
            </div>
        `;
    }

    attachEventListeners(overlay) {
        const closeBtn = overlay.querySelector('.settings-close-btn');
        const themeSelect = overlay.querySelector('select[name="theme"]');
        const languageSelect = overlay.querySelector('select[name="language"]');
        const httpVersionSelect = overlay.querySelector('select[name="httpVersion"]');
        const timeoutInput = overlay.querySelector('input[name="requestTimeout"]');

        // Tab switching
        const tabButtons = overlay.querySelectorAll('.settings-tab');
        const tabContents = overlay.querySelectorAll('.settings-tab-content');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.dataset.tab;

                // Remove active class from all tabs and contents
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                // Add active class to clicked tab and corresponding content
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

        // Proxy settings event listeners
        if (this.proxyController) {
            this.attachProxyEventListeners(overlay);
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

        // Get all proxy input fields
        const proxyType = overlay.querySelector('select[name="proxyType"]');
        const proxyHost = overlay.querySelector('input[name="proxyHost"]');
        const proxyPort = overlay.querySelector('input[name="proxyPort"]');
        const proxyUsername = overlay.querySelector('input[name="proxyUsername"]');
        const proxyPassword = overlay.querySelector('input[name="proxyPassword"]');
        const proxyBypass = overlay.querySelector('input[name="proxyBypass"]');

        // Toggle proxy settings visibility
        if (proxyEnabled && proxyContent) {
            proxyEnabled.addEventListener('change', async (e) => {
                proxyContent.style.display = e.target.checked ? 'block' : 'none';
                await this.saveProxySettings(overlay);
            });
        }

        // Toggle system proxy vs manual settings
        if (proxyUseSystem && proxyManualSettings) {
            proxyUseSystem.addEventListener('change', async (e) => {
                proxyManualSettings.style.display = e.target.checked ? 'none' : 'block';
                await this.saveProxySettings(overlay);
            });
        }

        // Toggle auth fields visibility
        if (proxyAuthEnabled && proxyAuthFields) {
            proxyAuthEnabled.addEventListener('change', async (e) => {
                proxyAuthFields.style.display = e.target.checked ? 'block' : 'none';
                await this.saveProxySettings(overlay);
            });
        }

        // Auto-save on change for all proxy fields
        const proxyFields = [proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword, proxyBypass];
        proxyFields.forEach(field => {
            if (field) {
                field.addEventListener('change', async () => {
                    await this.saveProxySettings(overlay);
                });
            }
        });

        // Test connection button
        if (proxyTestBtn && proxyTestResult) {
            proxyTestBtn.addEventListener('click', async () => {
                proxyTestBtn.disabled = true;
                proxyTestBtn.textContent = 'Testing...';
                proxyTestResult.textContent = '';
                proxyTestResult.className = 'proxy-test-result';

                try {
                    // Save settings before testing
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

            // Parse bypass list from comma-separated string
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
            console.error('Error saving proxy settings:', error);
        }
    }

    hide(overlay) {
        if (!this.isOpen) {return;}

        this.isOpen = false;
        overlay.remove();
    }
}