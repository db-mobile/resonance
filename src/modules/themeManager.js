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
    constructor(themeManager, i18nManager = null, httpVersionManager = null) {
        this.themeManager = themeManager;
        this.i18nManager = i18nManager;
        this.httpVersionManager = httpVersionManager;
        this.isOpen = false;
    }

    async show() {
        if (this.isOpen) return;
        
        this.isOpen = true;
        const modal = await this.createModal();
        document.body.appendChild(modal);
        
        const firstInput = modal.querySelector('input[type="radio"]');
        if (firstInput) firstInput.focus();
    }

    async createModal() {
        const overlay = document.createElement('div');
        overlay.className = 'settings-modal-overlay';
        
        const languageSection = this.i18nManager ? this.createLanguageSection() : '';
        
        const currentHttpVersion = this.httpVersionManager ? await this.httpVersionManager.getCurrentVersion() : 'auto';
        
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
                
                <div class="settings-content">
                    ${languageSection}
                    <div class="settings-section">
                        <h3 data-i18n="settings.theme">Theme</h3>
                        <div class="theme-options">
                            <label class="theme-option">
                                <input type="radio" name="theme" value="light" ${this.themeManager.getCurrentTheme() === 'light' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview light-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name" data-i18n="theme.light">Light</span>
                                        <span class="theme-description">Clean and bright interface</span>
                                    </div>
                                </div>
                            </label>
                            
                            <label class="theme-option">
                                <input type="radio" name="theme" value="dark" ${this.themeManager.getCurrentTheme() === 'dark' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview dark-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name" data-i18n="theme.dark">Dark</span>
                                        <span class="theme-description">Easy on the eyes</span>
                                    </div>
                                </div>
                            </label>
                            
                            <label class="theme-option">
                                <input type="radio" name="theme" value="system" ${this.themeManager.getCurrentTheme() === 'system' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview system-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name" data-i18n="theme.system">System</span>
                                        <span class="theme-description">Follow system preference</span>
                                    </div>
                                </div>
                            </label>
                            
                            <label class="theme-option">
                                <input type="radio" name="theme" value="blueprint" ${this.themeManager.getCurrentTheme() === 'blueprint' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview blueprint-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name" data-i18n="theme.blueprint">Blueprint</span>
                                        <span class="theme-description">Technical schematic design</span>
                                    </div>
                                </div>
                            </label>
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
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners(overlay);
        return overlay;
    }

    createLanguageSection() {
        if (!this.i18nManager) return '';
        
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
                </div>
            </div>
        `;
    }

    attachEventListeners(overlay) {
        const closeBtn = overlay.querySelector('.settings-close-btn');
        const themeInputs = overlay.querySelectorAll('input[name="theme"]');
        const languageSelect = overlay.querySelector('select[name="language"]');
        const httpVersionSelect = overlay.querySelector('select[name="httpVersion"]');

        closeBtn.addEventListener('click', () => this.hide(overlay));

        themeInputs.forEach(input => {
            input.addEventListener('change', async (e) => {
                await this.themeManager.setTheme(e.target.value);
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

    hide(overlay) {
        if (!this.isOpen) return;
        
        this.isOpen = false;
        overlay.remove();
    }
}