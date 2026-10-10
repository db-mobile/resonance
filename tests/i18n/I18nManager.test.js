/* global document */
import { I18nManager } from '../../src/i18n/I18nManager.js';

const LOCALES = {
    en: { settings: { title: 'Settings', group_requests: 'Requests' }, greet: 'Hello {{name}}' },
    de: { settings: { title: 'Einstellungen' }, greet: 'Hallo {{name}}' }
};

describe('I18nManager', () => {
    let fetchCalls;

    beforeEach(() => {
        fetchCalls = [];
        global.fetch = jest.fn((url) => {
            fetchCalls.push(url);
            const lang = url.match(/locales\/(.+)\.json$/)[1];
            if (!LOCALES[lang]) {
                return Promise.resolve({ ok: false });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(LOCALES[lang]) });
        });
    });

    afterEach(() => {
        delete global.fetch;
    });

    test('returns the active language when the key exists', async () => {
        const i18n = new I18nManager();
        await i18n.loadLanguage('de');
        expect(i18n.t('settings.title')).toBe('Einstellungen');
        expect(i18n.t('greet', { name: 'Ada' })).toBe('Hallo Ada');
    });

    test('falls back to English per key when the active language lacks it', async () => {
        const i18n = new I18nManager();
        await i18n.loadLanguage('de');
        expect(i18n.t('settings.group_requests')).toBe('Requests');
    });

    test('returns the key when no language has it', async () => {
        const i18n = new I18nManager();
        await i18n.loadLanguage('de');
        expect(i18n.t('settings.missing')).toBe('settings.missing');
    });

    test('returns the key instead of throwing for a non-string node', async () => {
        const i18n = new I18nManager();
        await i18n.loadLanguage('de');
        expect(i18n.t('settings')).toBe('settings');
    });

    test('loads English only once across language switches', async () => {
        const i18n = new I18nManager();
        await i18n.loadLanguage('de');
        await i18n.loadLanguage('en');
        await i18n.loadLanguage('de');
        expect(fetchCalls.filter(url => url.endsWith('/en.json'))).toHaveLength(1);
        expect(i18n.getCurrentLanguage()).toBe('de');
    });

    test('uses English when the requested locale fails to load', async () => {
        const i18n = new I18nManager();
        i18n.supportedLanguages.xx = 'Broken';
        await i18n.loadLanguage('xx');
        expect(i18n.getCurrentLanguage()).toBe('en');
        expect(i18n.t('settings.title')).toBe('Settings');
    });

    test('updateUI translates data-i18n-placeholder on inputs and textareas', async () => {
        const i18n = new I18nManager();
        await i18n.loadLanguage('de');
        const container = document.createElement('div');
        container.innerHTML = '<input data-i18n-placeholder="settings.title" placeholder="x">'
            + '<textarea data-i18n-placeholder="settings.group_requests" placeholder="y"></textarea>';

        i18n.updateUI(container);

        expect(container.querySelector('input').placeholder).toBe('Einstellungen');
        expect(container.querySelector('textarea').placeholder).toBe('Requests');
    });
});
