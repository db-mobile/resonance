/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { AuthManager } from '../../src/modules/authManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

// jsdom does not implement CSS.escape, which AuthManager._el uses on the
// prefixed path; real browsers provide it.
if (typeof global.CSS === 'undefined') {
    global.CSS = { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) };
}

function primeTemplate() {
    const html = fs.readFileSync(
        path.join(process.cwd(), 'src/templates/auth/authFields.html'),
        'utf8'
    );
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

/**
 * @param {Object} [extra]
 * @returns {AuthManager}
 */
function makeManager(extra = {}) {
    document.body.innerHTML = `
        <select id="auth-type-select"></select>
        <div id="auth-fields-container"></div>
    `;
    return new AuthManager({
        typeSelect: document.getElementById('auth-type-select'),
        fieldsContainer: document.getElementById('auth-fields-container'),
        ...extra
    });
}

describe('AuthManager bearer defaults', () => {
    let authManager;

    beforeEach(() => {
        primeTemplate();
        authManager = makeManager();
    });

    test('selecting bearer seeds the placeholder token into the config', () => {
        authManager.handleAuthTypeChange('bearer');

        expect(document.getElementById('bearer-token').value).toBe('{{bearerToken}}');
        expect(authManager.getAuthConfig().config.token).toBe('{{bearerToken}}');
    });

    test('loading an empty bearer config mutates the caller object', () => {
        const stored = { type: 'bearer', config: {} };
        authManager.loadAuthConfig(stored);

        expect(stored.config.token).toBe('{{bearerToken}}');
    });

    test('an empty string token is replaced by the placeholder', () => {
        authManager.loadAuthConfig({ type: 'bearer', config: { token: '' } });

        expect(document.getElementById('bearer-token').value).toBe('{{bearerToken}}');
    });

    test('a real token is left alone', () => {
        const stored = { type: 'bearer', config: { token: 'abc' } };
        authManager.loadAuthConfig(stored);

        expect(document.getElementById('bearer-token').value).toBe('abc');
        expect(stored.config.token).toBe('abc');
    });

    test('editing the token writes through', () => {
        authManager.handleAuthTypeChange('bearer');
        const input = document.getElementById('bearer-token');
        input.value = 'edited';
        input.dispatchEvent(new Event('input'));

        expect(authManager.getAuthConfig().config.token).toBe('edited');
    });
});

describe('AuthManager api-key defaults', () => {
    let authManager;

    beforeEach(() => {
        primeTemplate();
        authManager = makeManager();
    });

    test('selecting api-key seeds the header location', () => {
        authManager.handleAuthTypeChange('api-key');

        expect(authManager.getAuthConfig().config.location).toBe('header');
        expect(document.getElementById('api-key-location').value).toBe('header');
    });

    test('a stored query location is restored', () => {
        authManager.loadAuthConfig({
            type: 'api-key',
            config: { keyName: 'X-Key', keyValue: 'v', location: 'query' }
        });

        expect(document.getElementById('api-key-location').value).toBe('query');
    });
});

describe('AuthManager id prefixing', () => {
    let authManager;

    beforeEach(() => {
        primeTemplate();
        authManager = makeManager({ idPrefix: 'colauth-' });
    });

    test('digest fields resolve under the prefix and not at the bare id', () => {
        authManager.loadAuthConfig({
            type: 'digest',
            config: { username: 'ada', password: 'hunter2' }
        });

        const container = document.getElementById('auth-fields-container');
        expect(container.querySelector('#colauth-digest-username').value).toBe('ada');
        expect(container.querySelector('#colauth-digest-password').value).toBe('hunter2');
        expect(document.getElementById('digest-username')).toBeNull();
    });

    test('oauth2 fields and group reveals respect the prefix', () => {
        authManager.loadAuthConfig({
            type: 'oauth2',
            config: { clientId: 'cid', refreshToken: 'rt-1' }
        });

        const container = document.getElementById('auth-fields-container');
        expect(container.querySelector('#colauth-oauth2-client-id').value).toBe('cid');
        expect(container.querySelector('#colauth-oauth2-refresh-token').value).toBe('rt-1');
        expect(
            container.querySelector('#colauth-oauth2-refresh-token-group').classList.contains('u-hidden')
        ).toBe(false);
    });

    test('edits under the prefix still write through', () => {
        authManager.handleAuthTypeChange('ntlm');
        const container = document.getElementById('auth-fields-container');
        const input = container.querySelector('#colauth-ntlm-domain');
        input.value = 'CORP';
        input.dispatchEvent(new Event('input'));

        expect(authManager.getAuthConfig().config.domain).toBe('CORP');
    });
});

// renderAuthFields is now idempotent with respect to the current config: every
// type refills its inputs. Before the AUTH_FIELDS refactor basic/digest/api-key
// attached listeners without pre-filling, so a standalone render blanked the form.
describe('AuthManager renderAuthFields on its own', () => {
    let authManager;

    beforeEach(() => {
        primeTemplate();
        authManager = makeManager();
    });

    const prefilling = [
        ['ntlm', { username: 'ada' }, 'ntlm-username', 'ada'],
        ['aws-v4', { accessKeyId: 'AKIA' }, 'aws-access-key-id', 'AKIA']
    ];

    test.each(prefilling)('%s refills from the current config', (type, config, id, expected) => {
        authManager.loadAuthConfig({ type, config });
        authManager.renderAuthFields(type);

        expect(document.getElementById(id).value).toBe(expected);
    });

    const alsoPrefilling = [
        ['basic', { username: 'ada', password: 'pw' }, 'basic-username', 'ada'],
        ['digest', { username: 'ada', password: 'pw' }, 'digest-username', 'ada'],
        ['api-key', { keyName: 'X-Key', keyValue: 'v' }, 'api-key-name', 'X-Key']
    ];

    test.each(alsoPrefilling)('%s refills from the current config', (type, config, id, expected) => {
        authManager.loadAuthConfig({ type, config });
        authManager.renderAuthFields(type);

        expect(document.getElementById(id).value).toBe(expected);
    });
});

describe('AuthManager bug fixes', () => {
    let authManager;

    beforeEach(() => {
        primeTemplate();
        authManager = makeManager();
    });

    test('B2: the refresh-token field writes through when it can emit input', () => {
        authManager.loadAuthConfig({ type: 'oauth2', config: { refreshToken: 'rt-1' } });

        const input = document.getElementById('oauth2-refresh-token');
        input.removeAttribute('readonly');
        input.value = 'rt-2';
        input.dispatchEvent(new Event('input'));

        expect(authManager.getAuthConfig().config.refreshToken).toBe('rt-2');
    });

    test('B3: the authorization-code panel prefixes the ids it injects', () => {
        const prefixed = makeManager({ idPrefix: 'colauth-' });
        prefixed.loadAuthConfig({ type: 'oauth2', config: { grantType: 'authorization_code' } });

        prefixed._showAuthCodeInstructions();

        const container = document.getElementById('auth-fields-container');
        expect(container.querySelector('#colauth-oauth2-auth-code-input')).not.toBeNull();
        expect(container.querySelector('#colauth-oauth2-exchange-code-btn')).not.toBeNull();
    });

    test('B3: the unprefixed instance still injects bare ids', () => {
        authManager.loadAuthConfig({ type: 'oauth2', config: { grantType: 'authorization_code' } });

        authManager._showAuthCodeInstructions();

        expect(document.getElementById('oauth2-auth-code-input')).not.toBeNull();
        expect(document.getElementById('oauth2-exchange-code-btn')).not.toBeNull();
    });
});
