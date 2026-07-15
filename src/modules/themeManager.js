export class ThemeManager {
    constructor() {
        this.currentTheme = 'system';
        this.currentAccent = 'green';
        this.currentThemeLink = null;
        this.availableThemes = ['light', 'dark', 'system'];
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
            if (savedTheme === 'blueprint' || savedTheme === 'black') {
                savedTheme = 'dark';
                await this.saveTheme('dark');
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

            let themeFile = theme;
            if (theme === 'system') {
                themeFile = this.getSystemTheme();
            }

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `src/themes/${themeFile}.css`;
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
            window.dispatchEvent(new CustomEvent('resonance:theme-changed', { detail: { theme } }));
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
