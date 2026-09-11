/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { AuthManager } from '../../src/modules/authManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function el(id) {
    return document.getElementById(id);
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function hidden(id) {
    return el(id).classList.contains('u-hidden');
}

describe('AuthManager OAuth2', () => {
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

    describe('defaults on a fresh selection', () => {
        test('seeds grantType, headerPrefix and clientAuthMethod into the config', () => {
            authManager.handleAuthTypeChange('oauth2');

            const { config } = authManager.getAuthConfig();
            expect(config.grantType).toBe('client_credentials');
            expect(config.headerPrefix).toBe('Bearer');
            expect(config.clientAuthMethod).toBe('body');
        });

        test('shows the redirect-uri default in the input without seeding it into the config', () => {
            authManager.handleAuthTypeChange('oauth2');

            expect(el('oauth2-redirect-uri').value).toBe('http://localhost:8080/callback');
            expect(authManager.getAuthConfig().config.redirectUri).toBeUndefined();
        });
    });

    test('a stored falsy value is replaced by the seeded default', () => {
        authManager.loadAuthConfig({
            type: 'oauth2',
            config: { token: 'tok', headerPrefix: '' }
        });

        expect(el('oauth2-header-prefix').value).toBe('Bearer');
        expect(authManager.getAuthConfig().config.headerPrefix).toBe('Bearer');
    });

    describe('grant-type driven visibility', () => {
        test('authorization_code reveals auth url, redirect uri and pkce', () => {
            authManager.loadAuthConfig({
                type: 'oauth2',
                config: { grantType: 'authorization_code' }
            });

            expect(hidden('oauth2-auth-url-group')).toBe(false);
            expect(hidden('oauth2-redirect-uri-group')).toBe(false);
            expect(hidden('oauth2-pkce-group')).toBe(false);
            expect(hidden('oauth2-username-password-pair')).toBe(true);
        });

        test('password reveals the username/password pair only', () => {
            authManager.loadAuthConfig({
                type: 'oauth2',
                config: { grantType: 'password' }
            });

            expect(hidden('oauth2-username-password-pair')).toBe(false);
            expect(hidden('oauth2-auth-url-group')).toBe(true);
        });

        test('manual hides the whole token-fetch block and unlocks the token input', () => {
            authManager.loadAuthConfig({
                type: 'oauth2',
                config: { grantType: 'manual' }
            });

            expect(hidden('oauth2-token-url-group')).toBe(true);
            expect(hidden('oauth2-credentials-pair')).toBe(true);
            expect(hidden('oauth2-scope-group')).toBe(true);
            expect(hidden('oauth2-audience-group')).toBe(true);
            expect(hidden('oauth2-client-auth-group')).toBe(true);
            expect(hidden('oauth2-get-token-group')).toBe(true);
            expect(el('oauth2-token').hasAttribute('readonly')).toBe(false);
        });

        test('client_credentials keeps the token input read-only', () => {
            authManager.loadAuthConfig({
                type: 'oauth2',
                config: { grantType: 'client_credentials' }
            });

            expect(hidden('oauth2-token-url-group')).toBe(false);
            expect(el('oauth2-token').hasAttribute('readonly')).toBe(true);
        });

        test('changing the select re-runs the visibility rules', () => {
            authManager.handleAuthTypeChange('oauth2');
            expect(hidden('oauth2-pkce-group')).toBe(true);

            const select = el('oauth2-grant-type');
            select.value = 'authorization_code';
            select.dispatchEvent(new Event('change'));

            expect(hidden('oauth2-pkce-group')).toBe(false);
            expect(authManager.getAuthConfig().config.grantType).toBe('authorization_code');
        });
    });

    describe('the PKCE checkbox', () => {
        test('defaults to checked when the flag is absent', () => {
            authManager.loadAuthConfig({ type: 'oauth2', config: {} });
            expect(el('oauth2-use-pkce').checked).toBe(true);
        });

        test('stays checked when explicitly true', () => {
            authManager.loadAuthConfig({ type: 'oauth2', config: { usePkce: true } });
            expect(el('oauth2-use-pkce').checked).toBe(true);
        });

        test('is unchecked only when explicitly false', () => {
            authManager.loadAuthConfig({ type: 'oauth2', config: { usePkce: false } });
            expect(el('oauth2-use-pkce').checked).toBe(false);
        });
    });

    describe('the refresh token field', () => {
        test('is populated and its group revealed when a refresh token is stored', () => {
            authManager.loadAuthConfig({
                type: 'oauth2',
                config: { refreshToken: 'rt-1' }
            });

            expect(el('oauth2-refresh-token').value).toBe('rt-1');
            expect(hidden('oauth2-refresh-token-group')).toBe(false);
        });

        test('stays hidden when no refresh token is stored', () => {
            authManager.loadAuthConfig({ type: 'oauth2', config: {} });

            expect(hidden('oauth2-refresh-token-group')).toBe(true);
        });

        test('is read-only, which is why it cannot emit input events', () => {
            authManager.loadAuthConfig({ type: 'oauth2', config: { refreshToken: 'rt-1' } });

            expect(el('oauth2-refresh-token').hasAttribute('readonly')).toBe(true);
        });
    });

    describe('edits reach the config', () => {
        beforeEach(() => {
            authManager.handleAuthTypeChange('oauth2');
        });

        test('text inputs write through on input', () => {
            const input = el('oauth2-client-secret');
            input.value = 's3cret';
            input.dispatchEvent(new Event('input'));

            expect(authManager.getAuthConfig().config.clientSecret).toBe('s3cret');
        });

        test('selects write through on change', () => {
            const select = el('oauth2-client-auth');
            select.value = 'header';
            select.dispatchEvent(new Event('change'));

            expect(authManager.getAuthConfig().config.clientAuthMethod).toBe('header');
        });

        test('the pkce checkbox writes its checked state', () => {
            const box = el('oauth2-use-pkce');
            box.checked = false;
            box.dispatchEvent(new Event('change'));

            expect(authManager.getAuthConfig().config.usePkce).toBe(false);
        });

        test('every text field round-trips', () => {
            const fields = [
                ['oauth2-token-url', 'tokenUrl'],
                ['oauth2-auth-url', 'authorizationUrl'],
                ['oauth2-client-id', 'clientId'],
                ['oauth2-username', 'username'],
                ['oauth2-password', 'password'],
                ['oauth2-redirect-uri', 'redirectUri'],
                ['oauth2-scope', 'scope'],
                ['oauth2-audience', 'audience'],
                ['oauth2-header-prefix', 'headerPrefix']
            ];

            for (const [id, key] of fields) {
                const input = el(id);
                input.value = `v-${key}`;
                input.dispatchEvent(new Event('input'));
                expect(authManager.getAuthConfig().config[key]).toBe(`v-${key}`);
            }
        });
    });

    test('an unrecognised grant type normalises to an empty selection', () => {
        authManager.loadAuthConfig({
            type: 'oauth2',
            config: { grantType: 'bogus' }
        });

        expect(el('oauth2-grant-type').value).toBe('');
        expect(authManager.getAuthConfig().config.grantType).toBe('');
    });

    test('a full stored config populates every field', () => {
        authManager.loadAuthConfig({
            type: 'oauth2',
            config: {
                grantType: 'password',
                tokenUrl: 'https://t',
                authorizationUrl: 'https://a',
                clientId: 'cid',
                clientSecret: 'cs',
                username: 'ada',
                password: 'pw',
                redirectUri: 'https://r',
                scope: 'read',
                audience: 'aud',
                clientAuthMethod: 'header',
                token: 'tok',
                headerPrefix: 'Token'
            }
        });

        expect(el('oauth2-grant-type').value).toBe('password');
        expect(el('oauth2-token-url').value).toBe('https://t');
        expect(el('oauth2-auth-url').value).toBe('https://a');
        expect(el('oauth2-client-id').value).toBe('cid');
        expect(el('oauth2-client-secret').value).toBe('cs');
        expect(el('oauth2-username').value).toBe('ada');
        expect(el('oauth2-password').value).toBe('pw');
        expect(el('oauth2-redirect-uri').value).toBe('https://r');
        expect(el('oauth2-scope').value).toBe('read');
        expect(el('oauth2-audience').value).toBe('aud');
        expect(el('oauth2-client-auth').value).toBe('header');
        expect(el('oauth2-token').value).toBe('tok');
        expect(el('oauth2-header-prefix').value).toBe('Token');
    });
});

describe('AuthManager types without fields', () => {
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

    test('loading "none" does not throw', () => {
        expect(() => authManager.loadAuthConfig({ type: 'none', config: {} })).not.toThrow();
    });

    test('loading "inherit" does not throw', () => {
        expect(() => authManager.loadAuthConfig({ type: 'inherit', config: {} })).not.toThrow();
    });
});
