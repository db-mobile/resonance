/* global document, window, DOMParser, KeyboardEvent, HTMLInputElement */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { EnvironmentManager } from '../../src/modules/ui/EnvironmentManager.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const TEMPLATE_PATH = './src/templates/environment/environmentManager.html';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedTemplates() {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/environment/environmentManager.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

function makeService() {
    const environments = [
        { id: 'dev', name: 'Dev', color: '#FF0000', variables: { host: 'dev.example', token: '***' }, secretKeys: ['token'] },
        { id: 'prod', name: 'Prod', color: null, variables: {}, secretKeys: [] }
    ];
    return {
        environments,
        getAllEnvironments: jest.fn(async () => environments.map(env => ({ ...env }))),
        getActiveEnvironmentId: jest.fn(async () => 'dev'),
        getSecretValue: jest.fn(async () => 'secret-value'),
        updateEnvironment: jest.fn(async () => {}),
        switchEnvironment: jest.fn(async () => {}),
        duplicateEnvironment: jest.fn(async () => ({ id: 'copy' })),
        deleteEnvironment: jest.fn(async () => {}),
        setVariable: jest.fn(async () => {}),
        deleteVariable: jest.fn(async () => {}),
        createEnvironment: jest.fn(async (name) => ({ id: 'new', name })),
        exportEnvironment: jest.fn(async () => ({ name: 'Dev' })),
        exportAllEnvironments: jest.fn(async () => [{ name: 'Dev' }]),
        importEnvironments: jest.fn(async () => {})
    };
}

async function openManager(service) {
    const manager = new EnvironmentManager(service);
    const shown = manager.show();
    for (let i = 0; i < 6; i++) {
        await flush();
    }
    return { manager, shown };
}

describe('EnvironmentManager', () => {
    let service;

    beforeEach(() => {
        seedTemplates();
        service = makeService();
        window.backendAPI = { environments: { saveJsonExport: jest.fn(async () => ({ success: true })) } };
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.backendAPI;
        expect(escapeHandlerCount()).toBe(0);
    });

    test('renders the environment list with the active badge and selects the active one', async () => {
        const { manager } = await openManager(service);

        const items = Array.from(document.querySelectorAll('.env-list-item'));
        expect(items.map(i => i.querySelector('.env-list-item-name').textContent)).toEqual(['Dev', 'Prod']);
        expect(items[0].classList.contains('is-selected')).toBe(true);
        expect(items[0].querySelector('.env-list-item-active-badge')).not.toBeNull();
        expect(items[1].querySelector('.env-list-item-active-badge')).toBeNull();
        expect(items[0].querySelector('.env-color-indicator').style.getPropertyValue('--env-indicator-color')).toBe('#FF0000');
        expect(items[1].querySelector('.env-color-indicator').classList.contains('is-hidden')).toBe(true);

        manager.close();
    });

    test('shows the name, colour state and active badge in the details pane', async () => {
        const { manager } = await openManager(service);

        expect(document.querySelector('#env-name-input').value).toBe('Dev');
        expect(document.querySelector('#env-color-input').value).toBe('#ff0000');
        expect(document.querySelector('#env-color-input').dataset.savedColor).toBe('#FF0000');
        expect(document.querySelector('#env-color-value').textContent).toBe('#FF0000');
        expect(document.querySelector('#env-color-clear-btn').disabled).toBe(false);
        expect(document.querySelector('#env-set-active-btn').classList.contains('is-hidden')).toBe(true);
        expect(document.querySelector('.env-manager-active-badge').classList.contains('is-hidden')).toBe(false);

        manager.close();
    });

    test('an environment without a colour shows "None" and a disabled clear button', async () => {
        const { manager } = await openManager(service);

        document.querySelectorAll('.env-list-item')[1].click();
        for (let i = 0; i < 4; i++) {
            await flush();
        }

        expect(document.querySelector('#env-color-input').value).toBe('#4f46e5');
        expect(document.querySelector('#env-color-value').textContent).toBe('None');
        expect(document.querySelector('#env-color-clear-btn').disabled).toBe(true);
        expect(document.querySelector('#env-set-active-btn').classList.contains('is-hidden')).toBe(false);

        manager.close();
    });

    test('renders variable rows with the secret state resolved from the keychain', async () => {
        const { manager } = await openManager(service);

        const rows = Array.from(document.querySelectorAll('.env-variable-row'));
        expect(rows.map(r => r.querySelector('.var-name-input').value)).toEqual(['host', 'token']);
        const secretRow = rows[1];
        expect(secretRow.dataset.secret).toBe('true');
        expect(secretRow.querySelector('.var-value-input').value).toBe('secret-value');
        expect(secretRow.querySelector('.var-value-input').type).toBe('password');
        expect(secretRow.querySelector('.var-secret-btn').getAttribute('aria-pressed')).toBe('true');
        expect(secretRow.querySelector('.var-secret-btn').classList.contains('is-secret')).toBe(true);
        expect(secretRow.querySelector('.var-reveal-btn').classList.contains('is-hidden')).toBe(false);
        expect(rows[0].querySelector('.var-reveal-btn').classList.contains('is-hidden')).toBe(true);
        expect(rows[0].querySelector('.var-secret-btn').getAttribute('aria-pressed')).toBe('false');
        expect(document.querySelector('.env-variables-empty').classList.contains('is-hidden')).toBe(true);

        manager.close();
    });

    test('the reveal button toggles the value visibility', async () => {
        const { manager } = await openManager(service);
        const row = document.querySelectorAll('.env-variable-row')[1];
        const reveal = row.querySelector('.var-reveal-btn');

        reveal.click();
        expect(row.querySelector('.var-value-input').type).toBe('text');
        expect(reveal.title).toBe('Hide value');
        expect(reveal.querySelector('.icon').classList.contains('icon-eye-off')).toBe(true);

        reveal.click();
        expect(row.querySelector('.var-value-input').type).toBe('password');
        expect(reveal.title).toBe('Show value');

        manager.close();
    });

    test('toggling secret on a named row persists through the service', async () => {
        const { manager } = await openManager(service);
        const row = document.querySelectorAll('.env-variable-row')[0];

        row.querySelector('.var-secret-btn').click();
        await flush();

        expect(row.dataset.secret).toBe('true');
        expect(row.querySelector('.var-secret-btn').getAttribute('aria-pressed')).toBe('true');
        expect(service.setVariable).toHaveBeenCalledWith('dev', 'host', 'dev.example', true);

        manager.close();
    });

    test('renaming via the name input updates the environment', async () => {
        const { manager } = await openManager(service);
        const nameInput = document.querySelector('#env-name-input');

        nameInput.value = 'Development';
        nameInput.dispatchEvent(new Event('blur'));
        await flush();
        await flush();

        expect(service.updateEnvironment).toHaveBeenCalledWith('dev', { name: 'Development' });

        manager.close();
    });

    test('the colour input previews on input and saves on change', async () => {
        const { manager } = await openManager(service);
        const colorInput = document.querySelector('#env-color-input');

        colorInput.value = '#00ff00';
        colorInput.dispatchEvent(new Event('input'));
        expect(document.querySelector('#env-color-value').textContent).toBe('#00FF00');

        colorInput.dispatchEvent(new Event('change'));
        for (let i = 0; i < 6; i++) {
            await flush();
        }
        expect(service.updateEnvironment).toHaveBeenCalledWith('dev', { color: '#00FF00' });

        manager.close();
    });

    test('clearing the colour saves null and resets the preview', async () => {
        const { manager } = await openManager(service);

        document.querySelector('#env-color-clear-btn').click();
        expect(document.querySelector('#env-color-value').textContent).toBe('None');
        expect(document.querySelector('#env-color-input').value).toBe('#4f46e5');
        for (let i = 0; i < 6; i++) {
            await flush();
        }
        expect(service.updateEnvironment).toHaveBeenCalledWith('dev', { color: null });

        manager.close();
    });

    test('export writes the environment JSON through the native export', async () => {
        const { manager } = await openManager(service);

        document.querySelector('#env-export-btn').click();
        await flush();
        await flush();

        expect(window.backendAPI.environments.saveJsonExport).toHaveBeenCalledWith(
            'Dev_environment.json',
            JSON.stringify({ name: 'Dev' }, null, 2)
        );

        document.querySelector('#env-export-all-btn').click();
        await flush();
        await flush();
        expect(window.backendAPI.environments.saveJsonExport).toHaveBeenLastCalledWith(
            expect.stringMatching(/^resonance_environments_\d+\.json$/),
            JSON.stringify([{ name: 'Dev' }], null, 2)
        );

        manager.close();
    });

    test('saveJsonExport throws without a native export', async () => {
        delete window.backendAPI;
        const manager = new EnvironmentManager(service);
        await expect(manager.saveJsonExport('x.json', '{}')).rejects.toThrow('Native export is not available in this runtime');
    });

    test('close() resolves the show() promise with true and releases Escape', async () => {
        const { manager, shown } = await openManager(service);
        expect(escapeHandlerCount()).toBe(1);

        manager.close();

        await expect(shown).resolves.toBe(true);
        expect(document.querySelector('.environment-manager-overlay')).toBeNull();
    });

    test('Escape closes the dialog', async () => {
        const { shown } = await openManager(service);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(shown).resolves.toBe(true);
    });

    test('showAlert renders the message and closes on OK', async () => {
        const manager = new EnvironmentManager(service);
        manager.showAlert('Something failed');
        await flush();

        expect(document.querySelector('.dialog-message').textContent).toBe('Something failed');
        document.querySelector('#alert-dialog-ok').click();
        expect(document.querySelector('.modal-overlay')).toBeNull();
    });

    test('dismissing the import choice aborts instead of replacing all', async () => {
        const confirmHtml = fs.readFileSync(path.join(process.cwd(), 'src/templates/dialogs/confirmDialog.html'), 'utf8');
        templateLoader.cache.set('./src/templates/dialogs/confirmDialog.html', new DOMParser().parseFromString(confirmHtml, 'text/html'));
        const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
        const { manager } = await openManager(service);

        document.querySelector('#env-import-btn').click();
        expect(document.querySelector('.confirm-dialog')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flush();

        expect(document.querySelector('.confirm-dialog')).toBeNull();
        expect(document.querySelector('#env-import-btn')).not.toBeNull();
        expect(clickSpy).not.toHaveBeenCalled();

        clickSpy.mockRestore();
        manager.close();
    });
});
