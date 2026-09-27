/* global document, DOMParser, window */
import fs from 'fs';
import path from 'path';
import { SettingsModal } from '../../src/modules/ui/SettingsModal.js';
import { I18nManager } from '../../src/i18n/I18nManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/settings/settingsModal.html';

describe('SettingsModal translation', () => {
    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/settings/settingsModal.html'), 'utf8');
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
        window.backendAPI = { settings: { get: jest.fn().mockResolvedValue({}) } };
    });

    afterEach(() => {
        delete window.backendAPI;
        document.body.innerHTML = '';
    });

    test('the dialog is rendered in the active language when it opens', async () => {
        const de = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/i18n/locales/de.json'), 'utf8'));
        const i18n = new I18nManager();
        i18n.translations = de;
        i18n.currentLanguage = 'de';
        const themeManager = { getCurrentTheme: () => 'system', getAvailableAccents: () => [], getAccent: () => 'blue' };
        const modal = new SettingsModal(themeManager, i18n);

        const overlay = await modal.createModal();

        expect(overlay.querySelector('[data-i18n="settings.title"]').textContent).toBe(de.settings.title);
        expect(overlay.querySelector('[data-i18n="settings.group_appearance"]').textContent).toBe('Darstellung');
    });
});
