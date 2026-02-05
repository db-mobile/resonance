import { templateLoader } from './templateLoader.js';

export class ThemeManager {
    constructor() {
        this.currentTheme = 'system';
        this.currentAccent = 'green';
        this.currentThemeLink = null;
        this.baseOverridesLink = null;
        this.availableThemes = ['light', 'dark', 'system', 'black'];
        this.availableAccents = ['green', 'teal', 'blue', 'indigo', 'purple', 'yellow', 'orange', 'red', 'pink'];
        this.init();
    }

    async init() {
        await this.loadSavedTheme();
        await this.loadSavedAccent();
        await this.applyTheme(this.currentTheme);
        this.applyAccent(this.currentAccent);
        this.setupSystemThemeListener();
    }

    async loadSavedTheme() {
        try {
            let savedTheme = await window.backendAPI.store.get('theme');
            // Migrate blueprint to black
            if (savedTheme === 'blueprint') {
                savedTheme = 'black';
                await this.saveTheme('black');
            }
            this.currentTheme = savedTheme || 'system';
        } catch (error) {
            this.currentTheme = 'system';
        }
    }

    async loadSavedAccent() {
        try {
            const savedAccent = await window.backendAPI.store.get('accent');
            this.currentAccent = savedAccent || 'green';
        } catch (error) {
            this.currentAccent = 'green';
        }
    }

    async saveTheme(theme) {
        try {
            await window.backendAPI.store.set('theme', theme);
        } catch (error) {
            void error;
        }
    }

    async saveAccent(accent) {
        try {
            await window.backendAPI.store.set('accent', accent);
        } catch (error) {
            void error;
        }
    }

    applyAccent(accent) {
        document.documentElement.setAttribute('data-accent', accent);
        this.currentAccent = accent;
    }

    async setAccent(accent) {
        if (!this.availableAccents.includes(accent)) {
            return;
        }

        this.applyAccent(accent);
        await this.saveAccent(accent);
    }

    getAccent() {
        return this.currentAccent;
    }

    getAvailableAccents() {
        return [...this.availableAccents];
    }

    async loadThemeCSS(theme) {
        return new Promise((resolve, reject) => {
            if (this.currentThemeLink) {
                this.currentThemeLink.remove();
                this.currentThemeLink = null;
            }

            // If system theme is selected, resolve to actual theme (dark or light)
            let themeFile = theme;
            if (theme === 'system') {
                themeFile = this.getSystemTheme();
            }

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `src/themes/${themeFile}.css`;
            link.id = `theme-${theme}`;

            link.onload = async () => {
                this.currentThemeLink = link;
                // Load base overrides after theme variables are loaded
                await this.loadBaseOverrides();
                resolve();
            };

            link.onerror = () => {
                reject(new Error(`Failed to load theme: ${theme}`));
            };

            document.head.appendChild(link);
        });
    }

    async loadBaseOverrides() {
        // Remove existing base overrides to ensure correct order after theme
        if (this.baseOverridesLink) {
            this.baseOverridesLink.remove();
            this.baseOverridesLink = null;
        }

        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'src/themes/_base-overrides.css';
            link.id = 'theme-base-overrides';

            link.onload = () => {
                this.baseOverridesLink = link;
                resolve();
            };

            link.onerror = () => {
                // Base overrides are optional, continue without them
                resolve();
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
            if (theme !== 'system') {
                await this.applyTheme('system');
            }
        }
    }

    async setTheme(theme) {
        if (!this.availableThemes.includes(theme)) {
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

        // Set current theme selection
        const themeSelect = overlay.querySelector('select[name="theme"]');
        if (themeSelect) {
            themeSelect.value = this.themeManager.getCurrentTheme();
        }

        // Set current HTTP version selection
        const httpVersionSelect = overlay.querySelector('select[name="httpVersion"]');
        if (httpVersionSelect) {
            httpVersionSelect.value = currentHttpVersion;
        }

        // Set current timeout value
        const timeoutInput = overlay.querySelector('input[name="requestTimeout"]');
        if (timeoutInput) {
            timeoutInput.value = currentTimeout;
        }

        // Add language section if i18nManager is available
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

        // Add accent buttons
        const accentGrid = overlay.querySelector('[data-role="accent-grid"]');
        if (accentGrid) {
            this.createAccentButtonsDOM(accentGrid);
        }

        // Add proxy tab if proxyController is available
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
            green: '#10b981',
            teal: '#14b8a6',
            blue: '#3b82f6',
            indigo: '#6366f1',
            purple: '#8b5cf6',
            yellow: '#eab308',
            orange: '#f97316',
            red: '#ef4444',
            pink: '#ec4899'
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

        // Set enabled state
        const enabledCheckbox = section.querySelector('input[name="proxyEnabled"]');
        if (enabledCheckbox && settings.enabled) {
            enabledCheckbox.checked = true;
        }

        // Toggle visibility of proxy settings content
        const proxyContent = section.querySelector('.proxy-settings-content');
        if (proxyContent && settings.enabled) {
            proxyContent.classList.remove('is-hidden');
        }

        // Set use system proxy
        const useSystemCheckbox = section.querySelector('input[name="proxyUseSystem"]');
        if (useSystemCheckbox && settings.useSystemProxy) {
            useSystemCheckbox.checked = true;
        }

        // Toggle visibility of manual settings
        const manualSettings = section.querySelector('.proxy-manual-settings');
        if (manualSettings && settings.useSystemProxy) {
            manualSettings.classList.add('is-hidden');
        }

        // Set proxy type
        const typeSelect = section.querySelector('select[name="proxyType"]');
        if (typeSelect && settings.type) {
            typeSelect.value = settings.type;
        }

        // Set host and port
        const hostInput = section.querySelector('input[name="proxyHost"]');
        if (hostInput) {
            hostInput.value = settings.host || '';
        }
        const portInput = section.querySelector('input[name="proxyPort"]');
        if (portInput) {
            portInput.value = settings.port || '';
        }

        // Set auth enabled
        const authEnabledCheckbox = section.querySelector('input[name="proxyAuthEnabled"]');
        if (authEnabledCheckbox && settings.auth?.enabled) {
            authEnabledCheckbox.checked = true;
        }

        // Toggle visibility of auth fields
        const authFields = section.querySelector('.proxy-auth-fields');
        if (authFields && settings.auth?.enabled) {
            authFields.classList.remove('is-hidden');
        }

        // Set auth credentials
        const usernameInput = section.querySelector('input[name="proxyUsername"]');
        if (usernameInput) {
            usernameInput.value = settings.auth?.username || '';
        }
        const passwordInput = section.querySelector('input[name="proxyPassword"]');
        if (passwordInput) {
            passwordInput.value = settings.auth?.password || '';
        }

        // Set bypass list
        const bypassInput = section.querySelector('input[name="proxyBypass"]');
        if (bypassInput) {
            bypassInput.value = (settings.bypassList || []).join(', ');
        }

        return section;
    }

    attachEventListeners(overlay) {
        const closeBtn = overlay.querySelector('.dialog-close-btn');
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

        // Accent color button listeners
        const accentButtons = overlay.querySelectorAll('.accent-btn');
        accentButtons.forEach(btn => {
            if (btn.dataset.btnColor) {
                btn.style.setProperty('--btn-color', btn.dataset.btnColor);
            }
            btn.addEventListener('click', async () => {
                const { accent } = btn.dataset;
                await this.themeManager.setAccent(accent);

                // Update active state
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
                proxyContent.classList.toggle('is-hidden', !e.target.checked);
                await this.saveProxySettings(overlay);
            });
        }

        // Toggle system proxy vs manual settings
        if (proxyUseSystem && proxyManualSettings) {
            proxyUseSystem.addEventListener('change', async (e) => {
                proxyManualSettings.classList.toggle('is-hidden', e.target.checked);
                await this.saveProxySettings(overlay);
            });
        }

        // Toggle auth fields visibility
        if (proxyAuthEnabled && proxyAuthFields) {
            proxyAuthEnabled.addEventListener('change', async (e) => {
                proxyAuthFields.classList.toggle('is-hidden', !e.target.checked);
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
            void error;
        }
    }

    hide(overlay) {
        if (!this.isOpen) {return;}

        this.isOpen = false;
        overlay.remove();
    }
}