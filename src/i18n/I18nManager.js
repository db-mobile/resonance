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
            'es': 'Español'
        };
    }

    async init() {
        // Load saved language from storage or default to English
        this.currentLanguage = await this.getSavedLanguage() || 'en';
        
        // Load the current language translations
        await this.loadLanguage(this.currentLanguage);
        
        // Apply translations to the UI
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
                // Fall back to default language
                await this.loadLanguage(this.fallbackLanguage);
            }
        }
    }

    async setLanguage(language) {
        if (language === this.currentLanguage) {return;}
        
        await this.loadLanguage(language);
        await this.saveLanguage(language);
        this.updateUI();
        
        // Emit language change event
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
        
        // Replace parameters in the translation
        return this.interpolate(value, params);
    }

    interpolate(template, params) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => params[key] !== undefined ? params[key] : match);
    }

    updateUI(container = document) {
        // Update all elements with data-i18n attribute
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

        // Update elements with data-i18n-title attribute (for tooltips)
        const titleElements = container.querySelectorAll('[data-i18n-title]');
        titleElements.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            element.title = this.t(key);
        });

        // Update aria-label attributes
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

// Create global instance
export const i18n = new I18nManager();