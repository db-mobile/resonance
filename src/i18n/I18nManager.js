export class I18nManager {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = {};
        this.fallbackTranslations = {};
        this.fallbackLanguage = 'en';
        this.supportedLanguages = {
            'en': 'English',
            'de': 'Deutsch',
            'fr': 'Français',
            'it': 'Italiano',
            'es': 'Español',
            'pt-BR': 'Português (Brasil)'
        };
    }

    async init() {
        this.currentLanguage = await this.getSavedLanguage() || 'en';
        
        await this.loadLanguage(this.currentLanguage);
        
        this.updateUI();
    }

    async getSavedLanguage() {
        try {
            const settings = await window.backendAPI.settings.get();
            return settings.language || 'en';
        } catch (error) {
            return 'en';
        }
    }

    async saveLanguage(language) {
        try {
            const settings = await window.backendAPI.settings.get() || {};
            settings.language = language;
            await window.backendAPI.settings.set(settings);
        } catch (error) {
            void error;
        }
    }

    async fetchLocale(language) {
        const response = await fetch(`src/i18n/locales/${language}.json`);
        if (!response.ok) {
            throw new Error(`Failed to load language ${language}`);
        }
        return response.json();
    }

    async ensureFallbackLoaded() {
        if (Object.keys(this.fallbackTranslations).length > 0) {return;}
        try {
            this.fallbackTranslations = await this.fetchLocale(this.fallbackLanguage);
        } catch (error) {
            void error;
        }
    }

    async loadLanguage(language) {
        if (!this.supportedLanguages[language]) {
            language = this.fallbackLanguage;
        }

        await this.ensureFallbackLoaded();

        if (language === this.fallbackLanguage) {
            this.translations = this.fallbackTranslations;
            this.currentLanguage = language;
            return;
        }

        try {
            this.translations = await this.fetchLocale(language);
            this.currentLanguage = language;
        } catch (error) {
            this.translations = this.fallbackTranslations;
            this.currentLanguage = this.fallbackLanguage;
        }
    }

    lookup(dictionary, key) {
        let value = dictionary;
        for (const k of key.split('.')) {
            value = value?.[k];
            if (value === undefined) {return undefined;}
        }
        return value;
    }

    async setLanguage(language) {
        if (language === this.currentLanguage) {return;}
        
        await this.loadLanguage(language);
        await this.saveLanguage(language);
        this.updateUI();
        
        document.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { language: this.currentLanguage } 
        }));
    }

    t(key, params = {}) {
        let value = this.lookup(this.translations, key);
        if (typeof value !== 'string') {
            value = this.lookup(this.fallbackTranslations, key);
        }
        if (typeof value !== 'string') {
            return key;
        }
        return this.interpolate(value, params);
    }

    interpolate(template, params) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => params[key] !== undefined ? params[key] : match);
    }

    updateUI(container = document) {
        const elements = container.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);

            if (element.tagName === 'INPUT' && element.type === 'text') {
                element.placeholder = translation;
            } else {
                element.textContent = translation;
            }
        });

        const titleElements = container.querySelectorAll('[data-i18n-title]');
        titleElements.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const shortcutHint = element.getAttribute('data-shortcut-hint');
            const title = this.t(key);
            element.title = shortcutHint ? `${title} (${shortcutHint})` : title;
        });

        const ariaElements = container.querySelectorAll('[data-i18n-aria]');
        ariaElements.forEach(element => {
            const key = element.getAttribute('data-i18n-aria');
            element.setAttribute('aria-label', this.t(key));
        });
    }

    getCurrentLanguage() {
        return this.currentLanguage;
    }

    getSupportedLanguages() {
        return this.supportedLanguages;
    }
}

export const i18n = new I18nManager();