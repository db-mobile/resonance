/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { AuthManager } from '../../src/modules/authManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

const FIRST_FIELD = {
    bearer: 'bearer-token',
    basic: 'basic-username',
    'api-key': 'api-key-name',
    oauth2: 'oauth2-grant-type',
    digest: 'digest-username',
    ntlm: 'ntlm-username',
    'aws-v4': 'aws-access-key-id'
};

function makeManager(options = {}) {
    return new AuthManager({
        typeSelect: document.getElementById('auth-type-select'),
        fieldsContainer: document.getElementById('auth-fields-container'),
        ...options
    });
}

const container = () => document.getElementById('auth-fields-container');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AuthManager.renderAuthFields', () => {
    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/auth/authFields.html'), 'utf8');
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
        document.body.innerHTML = '<select id="auth-type-select"></select><div id="auth-fields-container"></div>';
    });

    test.each(Object.entries(FIRST_FIELD))('%s mounts its template', (type, firstField) => {
        makeManager().renderAuthFields(type);

        expect(document.getElementById(firstField)).not.toBeNull();
    });

    test('none and unknown types leave the container empty', () => {
        const manager = makeManager();
        manager.renderAuthFields('bearer');

        manager.renderAuthFields('none');
        expect(container().innerHTML).toBe('');

        manager.renderAuthFields('carrier-pigeon');
        expect(container().innerHTML).toBe('');
    });

    test('inherit shows the static summary and keeps the edit button hidden', () => {
        makeManager({ inheritSummary: 'Falls back to the collection.' }).renderAuthFields('inherit');

        expect(document.getElementById('inherit-auth-summary').textContent).toBe('Falls back to the collection.');
        expect(document.getElementById('inherit-edit-collection-auth').hidden).toBe(true);
    });

    test('inherit resolves the inherited source and wires the edit button', async () => {
        const manager = makeManager();
        manager.getInheritedAuthInfo = jest.fn(async () => ({ collectionId: 'c1', collectionName: 'Shop', folderId: 'f1', folderName: 'Admin', authType: 'bearer' }));
        manager.onOpenCollectionAuth = jest.fn();

        manager.renderAuthFields('inherit');
        await flush();

        expect(document.getElementById('inherit-auth-summary').textContent).toBe('Inheriting Bearer Token from folder "Admin".');
        const button = document.getElementById('inherit-edit-collection-auth');
        expect(button.hidden).toBe(false);
        expect(button.textContent).toBe('Edit folder auth');
        button.click();
        expect(manager.onOpenCollectionAuth).toHaveBeenCalledWith('c1', 'f1');
    });

    test('inherit from a collection without auth explains the unauthenticated send', async () => {
        const manager = makeManager();
        manager.getInheritedAuthInfo = jest.fn(async () => ({ collectionId: 'c1', collectionName: 'Shop', folderId: null, folderName: '', authType: 'none' }));
        manager.onOpenCollectionAuth = jest.fn();

        manager.renderAuthFields('inherit');
        await flush();

        expect(document.getElementById('inherit-auth-summary').textContent).toBe('Collection "Shop" has no auth configured — this request is sent unauthenticated.');
        expect(document.getElementById('inherit-edit-collection-auth').textContent).toBe('Edit collection auth');
    });

    test('a null inherited info leaves the summary untouched', async () => {
        const manager = makeManager({ inheritSummary: 'static' });
        manager.getInheritedAuthInfo = jest.fn(async () => null);

        manager.renderAuthFields('inherit');
        await flush();

        expect(document.getElementById('inherit-auth-summary').textContent).toBe('static');
    });

    test('getAuthTypeLabel maps known types and echoes unknown ones', () => {
        const manager = makeManager();
        expect(manager.getAuthTypeLabel('aws-v4')).toBe('AWS Signature');
        expect(manager.getAuthTypeLabel('inherit')).toBe('Inherit from Parent');
        expect(manager.getAuthTypeLabel('x')).toBe('x');
    });
});
