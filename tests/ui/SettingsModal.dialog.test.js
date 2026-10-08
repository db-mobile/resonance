/* global document, DOMParser, window, KeyboardEvent */
import fs from 'fs';
import path from 'path';
import { SettingsModal } from '../../src/modules/ui/SettingsModal.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { pushEscapeHandler, escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';
import { app } from '../../src/modules/appContext.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { updateSetting } from '../../src/modules/state/settingsCache.js';

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() }
}));

jest.mock('../../src/modules/state/settingsCache.js', () => ({
    updateSetting: jest.fn()
}));

const TEMPLATE_PATH = './src/templates/settings/settingsModal.html';
const CONFIRM_TEMPLATE_PATH = './src/templates/dialogs/confirmDialog.html';

const loadTemplate = (cacheKey, file) => {
    const html = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    templateLoader.cache.set(cacheKey, new DOMParser().parseFromString(html, 'text/html'));
};

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const themeManager = { getCurrentTheme: () => 'system', getAvailableAccents: () => [], getAccent: () => 'blue' };

describe('SettingsModal dialog behaviour', () => {
    let modal;

    beforeEach(() => {
        loadTemplate(TEMPLATE_PATH, 'src/templates/settings/settingsModal.html');
        loadTemplate(CONFIRM_TEMPLATE_PATH, 'src/templates/dialogs/confirmDialog.html');
        window.backendAPI = { settings: { get: jest.fn().mockResolvedValue({}) } };
        toast.error.mockClear();
        updateSetting.mockReset();
    });

    afterEach(() => {
        modal?.hide();
        modal = null;
        delete window.backendAPI;
        delete app.i18n;
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    test('the dialog is labelled by its title and marked modal', async () => {
        modal = new SettingsModal(themeManager);
        await modal.show();

        const dialog = document.querySelector('.modal-dialog--settings');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')).classList.contains('dialog-title')).toBe(true);
        expect(dialog.querySelector('.settings-footer')).toBeNull();
    });

    test('closing restores focus to the element that opened it', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        modal = new SettingsModal(themeManager);
        await modal.show();
        expect(document.activeElement).not.toBe(opener);

        document.querySelector('.modal-dialog--settings .dialog-close-btn').click();

        expect(document.querySelector('.modal-dialog--settings')).toBeNull();
        expect(modal.isOpen).toBe(false);
        expect(document.activeElement).toBe(opener);
    });

    test('Escape closes only the top-most dialog', async () => {
        modal = new SettingsModal(themeManager);
        await modal.show();
        const top = jest.fn();
        const release = pushEscapeHandler(top);

        pressEscape();

        expect(top).toHaveBeenCalledTimes(1);
        expect(modal.isOpen).toBe(true);
        expect(document.querySelector('.modal-dialog--settings')).not.toBeNull();

        release();
        pressEscape();

        expect(modal.isOpen).toBe(false);
        expect(document.querySelector('.modal-dialog--settings')).toBeNull();
    });

    test('a click on the overlay closes the dialog', async () => {
        modal = new SettingsModal(themeManager);
        await modal.show();

        document.querySelector('.settings-modal-overlay').click();

        expect(modal.isOpen).toBe(false);
        expect(document.querySelector('.settings-modal-overlay')).toBeNull();
    });

    test('the proxy test button keeps its translated label', async () => {
        app.i18n = {
            t: (key) => ({ 'settings.proxy_testing': 'Teste...', 'settings.proxy_test': 'Verbindung testen' }[key] || key)
        };
        let finishTest;
        const proxyController = {
            getSettings: jest.fn().mockResolvedValue({}),
            updateSettings: jest.fn().mockResolvedValue(),
            testConnection: jest.fn(() => new Promise(resolve => { finishTest = resolve; }))
        };
        modal = new SettingsModal(themeManager, null, null, null, proxyController);
        await modal.show();
        const button = document.querySelector('.proxy-test-btn');

        button.click();
        await flush();
        expect(button.textContent).toBe('Teste...');

        finishTest({ success: true, message: 'ok' });
        await flush();
        expect(button.textContent).toBe('Verbindung testen');
    });

    test('a failed proxy save is reported', async () => {
        const proxyController = {
            getSettings: jest.fn().mockResolvedValue({}),
            updateSettings: jest.fn().mockRejectedValue(new Error('disk full'))
        };
        modal = new SettingsModal(themeManager, null, null, null, proxyController);
        await modal.show();

        await modal.saveProxySettings(modal.dialog);

        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    });

    test('a failed setting save is reported', async () => {
        updateSetting.mockRejectedValue(new Error('denied'));
        modal = new SettingsModal(themeManager);
        await modal.show();

        document.querySelector('input[name="verifySsl"]').dispatchEvent(new Event('change'));
        await flush();

        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('denied'));
    });

    describe('certificates', () => {
        let certificateController;

        beforeEach(() => {
            certificateController = {
                getItems: jest.fn().mockResolvedValue([{ host: 'api.example.com', certPath: '', keyPath: '', caPath: '', enabled: true }]),
                saveItems: jest.fn().mockResolvedValue(),
                validateEntry: jest.fn(() => [])
            };
        });

        test('removing a certificate asks for confirmation first', async () => {
            modal = new SettingsModal(themeManager, null, null, null, null, certificateController);
            await modal.show();

            document.querySelector('[data-role="cert-remove"]').click();

            expect(document.querySelector('.cert-entry')).not.toBeNull();
            expect(document.getElementById('confirm-confirm-btn').classList.contains('btn-danger')).toBe(true);

            document.getElementById('confirm-cancel-btn').click();
            await flush();

            expect(document.querySelector('.cert-entry')).not.toBeNull();
            expect(certificateController.saveItems).not.toHaveBeenCalled();

            document.querySelector('[data-role="cert-remove"]').click();
            document.getElementById('confirm-confirm-btn').click();
            await flush();

            expect(document.querySelector('.cert-entry')).toBeNull();
            expect(certificateController.saveItems).toHaveBeenCalledWith([]);
        });

        test('a failed certificate save is reported', async () => {
            certificateController.saveItems.mockRejectedValue(new Error('locked'));
            modal = new SettingsModal(themeManager, null, null, null, null, certificateController);
            await modal.show();

            await modal._saveCerts();

            expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('locked'));
        });
    });
});
