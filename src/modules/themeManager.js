/**
 * Theme Manager - Handles theme switching and persistence with dynamic CSS loading
 */
export class ThemeManager {
    constructor() {
        this.currentTheme = 'system';
        this.currentThemeLink = null;
        this.availableThemes = ['light', 'dark', 'system'];
        this.init();
    }

    async init() {
        // Load saved theme or default to system
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
            // Remove existing theme CSS if any
            if (this.currentThemeLink) {
                this.currentThemeLink.remove();
                this.currentThemeLink = null;
            }

            // Create new link element for the theme
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

            // Add to head
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
            // Fallback to system theme
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
        // Listen for system theme changes
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', async () => {
                if (this.currentTheme === 'system') {
                    // Reload system theme to reflect changes
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

// Settings Modal Component
export class SettingsModal {
    constructor(themeManager) {
        this.themeManager = themeManager;
        this.isOpen = false;
    }

    show() {
        if (this.isOpen) return;
        
        this.isOpen = true;
        const modal = this.createModal();
        document.body.appendChild(modal);
        
        // Focus management
        const firstInput = modal.querySelector('input[type="radio"]');
        if (firstInput) firstInput.focus();
    }

    createModal() {
        const overlay = document.createElement('div');
        overlay.className = 'settings-modal-overlay';
        overlay.innerHTML = `
            <div class="settings-modal">
                <div class="settings-header">
                    <h2>Settings</h2>
                    <button class="settings-close-btn" aria-label="Close Settings">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                
                <div class="settings-content">
                    <div class="settings-section">
                        <h3>Appearance</h3>
                        <div class="theme-options">
                            <label class="theme-option">
                                <input type="radio" name="theme" value="light" ${this.themeManager.getCurrentTheme() === 'light' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview light-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name">Light</span>
                                        <span class="theme-description">Clean and bright interface</span>
                                    </div>
                                </div>
                            </label>
                            
                            <label class="theme-option">
                                <input type="radio" name="theme" value="dark" ${this.themeManager.getCurrentTheme() === 'dark' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview dark-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name">Dark</span>
                                        <span class="theme-description">Easy on the eyes</span>
                                    </div>
                                </div>
                            </label>
                            
                            <label class="theme-option">
                                <input type="radio" name="theme" value="system" ${this.themeManager.getCurrentTheme() === 'system' ? 'checked' : ''}>
                                <div class="theme-option-content">
                                    <div class="theme-preview system-preview"></div>
                                    <div class="theme-option-text">
                                        <span class="theme-name">System</span>
                                        <span class="theme-description">Follow system preference</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners(overlay);
        return overlay;
    }

    attachEventListeners(overlay) {
        const closeBtn = overlay.querySelector('.settings-close-btn');
        const themeInputs = overlay.querySelectorAll('input[name="theme"]');

        // Close button
        closeBtn.addEventListener('click', () => this.hide(overlay));

        // Theme selection
        themeInputs.forEach(input => {
            input.addEventListener('change', async (e) => {
                await this.themeManager.setTheme(e.target.value);
            });
        });

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide(overlay);
            }
        });

        // Close on escape key
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