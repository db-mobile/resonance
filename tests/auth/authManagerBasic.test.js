/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { AuthManager } from '../../src/modules/authManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { textToBase64 } from '../../src/modules/utils/encoding.js';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

describe('AuthManager Basic auth encoding', () => {
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

    test('ASCII credentials keep the classic btoa encoding', () => {
        authManager.loadAuthConfig({
            type: 'basic',
            config: { username: 'user', password: 'pass' }
        });

        const authData = authManager.generateAuthData();

        expect(authData.headers['Authorization']).toBe(`Basic ${btoa('user:pass')}`);
    });

    test('non-Latin-1 credentials are encoded as UTF-8 instead of throwing', () => {
        authManager.loadAuthConfig({
            type: 'basic',
            config: { username: 'ada', password: 'pä密码' }
        });

        const authData = authManager.generateAuthData();

        expect(authData.headers['Authorization']).toBe(`Basic ${textToBase64('ada:pä密码')}`);
    });
});
