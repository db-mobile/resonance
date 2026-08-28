/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { AuthManager } from '../../src/modules/authManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

describe('AuthManager NTLM round-trip', () => {
    let authManager;

    beforeEach(() => {
        const html = fs.readFileSync(
            path.join(process.cwd(), 'src/templates/auth/authFields.html'),
            'utf8'
        );
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));

        document.body.innerHTML = `
            <select id="auth-type-select"></select>
            <div id="auth-fields-container"></div>
        `;

        authManager = new AuthManager({
            typeSelect: document.getElementById('auth-type-select'),
            fieldsContainer: document.getElementById('auth-fields-container')
        });
    });

    test('loads a stored config into all four fields', () => {
        authManager.loadAuthConfig({
            type: 'ntlm',
            config: { username: 'ada', password: 'hunter2', domain: 'CORP', workstation: 'DEV-BOX' }
        });

        expect(document.getElementById('ntlm-username').value).toBe('ada');
        expect(document.getElementById('ntlm-password').value).toBe('hunter2');
        expect(document.getElementById('ntlm-domain').value).toBe('CORP');
        expect(document.getElementById('ntlm-workstation').value).toBe('DEV-BOX');
    });

    test('generates an ntlmAuth payload with empty optional fields defaulted', () => {
        authManager.loadAuthConfig({
            type: 'ntlm',
            config: { username: 'ada', password: 'hunter2' }
        });

        const authData = authManager.generateAuthData();

        expect(authData.ntlmAuth).toEqual({
            username: 'ada',
            password: 'hunter2',
            domain: '',
            workstation: ''
        });
        expect(authData.headers).toEqual({});
        expect(authData.authConfig).toBeNull();
    });

    test('generates no ntlmAuth payload without credentials', () => {
        authManager.loadAuthConfig({
            type: 'ntlm',
            config: { domain: 'CORP' }
        });

        expect(authManager.generateAuthData().ntlmAuth).toBeUndefined();
    });

    test('edited fields update the current config', () => {
        authManager.loadAuthConfig({
            type: 'ntlm',
            config: { username: 'ada', password: 'hunter2', domain: 'CORP', workstation: '' }
        });

        const domainInput = document.getElementById('ntlm-domain');
        domainInput.value = 'LAB';
        domainInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(authManager.getAuthConfig().config.domain).toBe('LAB');
    });

    test('does not clobber stored values before populate runs', () => {
        const stored = {
            type: 'ntlm',
            config: { username: 'ada', password: 'hunter2', domain: 'CORP', workstation: 'DEV-BOX' }
        };

        authManager.loadAuthConfig(stored);

        expect(stored.config.username).toBe('ada');
        expect(stored.config.domain).toBe('CORP');
        expect(stored.config.workstation).toBe('DEV-BOX');
    });
});
