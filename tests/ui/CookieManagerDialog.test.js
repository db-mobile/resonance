/* global document, window, KeyboardEvent, DOMParser */
import fs from 'fs';
import path from 'path';
import { CookieManagerDialog } from '../../src/modules/ui/CookieManagerDialog.js';
import { CookieJarService } from '../../src/modules/services/CookieJarService.js';
import { CookieRepository } from '../../src/modules/storage/CookieRepository.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const MANAGER_TEMPLATE = './src/templates/cookies/cookieManager.html';

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CookieManagerDialog add/edit', () => {
    let service;
    let dialog;
    let storeData;

    beforeEach(() => {
        document.body.innerHTML = '';
        storeData = {};
        window.backendAPI = {
            store: {
                get: jest.fn(async (key) => storeData[key]),
                set: jest.fn(async (key, value) => {
                    storeData[key] = value;
                })
            },
            settings: {
                get: jest.fn(async () => ({ cookieJarEnabled: true }))
            }
        };
        templateLoader.cache.set(
            MANAGER_TEMPLATE,
            new DOMParser().parseFromString(
                fs.readFileSync(path.join(process.cwd(), 'src/templates/cookies/cookieManager.html'), 'utf8'),
                'text/html'
            )
        );
        service = new CookieJarService(new CookieRepository(window.backendAPI));
        dialog = new CookieManagerDialog(service, {
            getAllEnvironments: jest.fn(async () => [{ id: 'env-dev', name: 'Dev', color: null }])
        });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    async function openDialog() {
        const shown = dialog.show('env-dev', 'Dev');
        shown.catch(() => {});
        await flush();
        await flush();
    }

    function content() {
        return document.querySelector('.cookie-manager-dialog');
    }

    test('add flow creates a cookie and renders its row', async () => {
        await openDialog();
        const root = content();

        root.querySelector('#cookie-manager-add-btn').click();
        expect(root.querySelector('#cookie-editor').classList.contains('is-hidden')).toBe(false);

        root.querySelector('#cookie-editor-name').value = 'session';
        root.querySelector('#cookie-editor-value').value = 'abc';
        root.querySelector('#cookie-editor-domain').value = 'api.example.com';
        root.querySelector('#cookie-editor-secure').checked = true;
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        expect(root.querySelector('#cookie-editor').classList.contains('is-hidden')).toBe(true);
        const rows = root.querySelectorAll('#cookie-manager-tbody tr');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('session');
        expect(rows[0].textContent).toContain('api.example.com');

        const stored = await service.getAll('env-dev');
        expect(stored).toHaveLength(1);
        expect(stored[0].secure).toBe(true);

        dialog._close();
    });

    test('edit flow prefills the form and updates in place', async () => {
        await service.putCookie(
            { name: 'session', value: 'old', domain: 'api.example.com', path: '/' },
            'env-dev'
        );
        await openDialog();
        const root = content();

        const buttons = [...root.querySelectorAll('#cookie-manager-tbody button')];
        const editBtn = buttons.find((b) => b.textContent === 'Edit');
        editBtn.click();

        expect(root.querySelector('#cookie-editor-name').value).toBe('session');
        expect(root.querySelector('#cookie-editor-value').value).toBe('old');

        root.querySelector('#cookie-editor-value').value = 'rotated';
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        const stored = await service.getAll('env-dev');
        expect(stored).toHaveLength(1);
        expect(stored[0].value).toBe('rotated');

        dialog._close();
    });

    test('validation failure shows a message and keeps the editor open', async () => {
        await openDialog();
        const root = content();

        root.querySelector('#cookie-manager-add-btn').click();
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        const error = root.querySelector('#cookie-editor-error');
        expect(error.classList.contains('is-hidden')).toBe(false);
        expect(error.textContent).not.toBe('');
        expect(root.querySelector('#cookie-editor').classList.contains('is-hidden')).toBe(false);
        expect(await service.getAll('env-dev')).toHaveLength(0);

        dialog._close();
    });

    test('a typed expiry is parsed as local time and round-trips through edit', async () => {
        await openDialog();
        const root = content();

        root.querySelector('#cookie-manager-add-btn').click();
        root.querySelector('#cookie-editor-name').value = 'session';
        root.querySelector('#cookie-editor-value').value = 'abc';
        root.querySelector('#cookie-editor-domain').value = 'api.example.com';
        root.querySelector('#cookie-editor-expires').value = '2030-06-01 14:30';
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        const [stored] = await service.getAll('env-dev');
        expect(stored.expires).toBe(new Date(2030, 5, 1, 14, 30).getTime());

        const editBtn = [...root.querySelectorAll('#cookie-manager-tbody button')]
            .find((b) => b.textContent === 'Edit');
        editBtn.click();
        expect(root.querySelector('#cookie-editor-expires').value).toBe('2030-06-01 14:30');

        dialog._close();
    });

    test('a bare date is accepted and an empty field means a session cookie', async () => {
        await openDialog();
        const root = content();

        root.querySelector('#cookie-manager-add-btn').click();
        root.querySelector('#cookie-editor-name').value = 'dated';
        root.querySelector('#cookie-editor-domain').value = 'api.example.com';
        root.querySelector('#cookie-editor-expires').value = '2030-06-01';
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        const dated = (await service.getAll('env-dev')).find((c) => c.name === 'dated');
        expect(dated.expires).toBe(new Date(2030, 5, 1, 0, 0).getTime());

        root.querySelector('#cookie-manager-add-btn').click();
        root.querySelector('#cookie-editor-name').value = 'sessional';
        root.querySelector('#cookie-editor-domain').value = 'api.example.com';
        root.querySelector('#cookie-editor-expires').value = '   ';
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        const sessional = (await service.getAll('env-dev')).find((c) => c.name === 'sessional');
        expect(sessional.expires).toBeNull();

        dialog._close();
    });

    test('an unparseable expiry is rejected with a message', async () => {
        await openDialog();
        const root = content();

        root.querySelector('#cookie-manager-add-btn').click();
        root.querySelector('#cookie-editor-name').value = 'bad';
        root.querySelector('#cookie-editor-domain').value = 'api.example.com';
        root.querySelector('#cookie-editor-expires').value = 'whenever';
        root.querySelector('#cookie-editor-save-btn').click();
        await flush();

        const error = root.querySelector('#cookie-editor-error');
        expect(error.classList.contains('is-hidden')).toBe(false);
        expect(error.textContent).toContain('date');
        expect(await service.getAll('env-dev')).toHaveLength(0);

        dialog._close();
    });

    test('Escape closes the editor first, then the dialog', async () => {
        await openDialog();
        const root = content();

        root.querySelector('#cookie-manager-add-btn').click();
        expect(root.querySelector('#cookie-editor').classList.contains('is-hidden')).toBe(false);

        pressEscape();
        expect(root.querySelector('#cookie-editor').classList.contains('is-hidden')).toBe(true);
        expect(document.querySelector('.cookie-manager-dialog')).not.toBeNull();

        pressEscape();
        expect(document.querySelector('.cookie-manager-dialog')).toBeNull();
    });
});
