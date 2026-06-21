/**
 * Internationalization Manager
 * Handles language switching and translation functionality
 */
export class I18nManager {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = {};
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

    async loadLanguage(language) {
        if (!this.supportedLanguages[language]) {
            language = this.fallbackLanguage;
        }

        try {
            const response = await fetch(`src/i18n/locales/${language}.json`);
            if (!response.ok) {
                throw new Error(`Failed to load language ${language}`);
            }
            this.translations = await response.json();
            this.currentLanguage = language;
        } catch (error) {
            if (language !== this.fallbackLanguage) {
                await this.loadLanguage(this.fallbackLanguage);
            }
        }
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
        const keys = key.split('.');
        let value = this.translations;
        
        for (const k of keys) {
            value = value?.[k];
            if (value === undefined) {break;}
        }
        
        if (value === undefined) {
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