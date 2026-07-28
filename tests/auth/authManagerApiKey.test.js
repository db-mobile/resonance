/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { AuthManager } from '../../src/modules/authManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/auth/authFields.html';

/**
 * Reopening a saved API-key request must not move the key.
 *
 * The field renderers run before populateAuthFields, and loadAuthConfig keeps
 * the caller's object by reference, so a renderer that writes a default
 * straight onto currentAuthConfig.config overwrites the stored choice before
 * anything reads it back.
 */
describe('AuthManager api-key location round-trip', () => {
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

    test('keeps a stored query location when the config is loaded', () => {
        authManager.loadAuthConfig({
            type: 'api-key',
            config: { keyName: 'X-API-Key', keyValue: 'secret', location: 'query' }
        });

        expect(authManager.getAuthConfig().config.location).toBe('query');
        expect(document.getElementById('api-key-location').value).toBe('query');
    });

    test('sends a stored query key as a query parameter, not a header', () => {
        authManager.loadAuthConfig({
            type: 'api-key',
            config: { keyName: 'X-API-Key', keyValue: 'secret', location: 'query' }
        });

        const authData = authManager.generateAuthData();

        expect(authData.queryParams).toEqual({ 'X-API-Key': 'secret' });
        expect(authData.headers).toEqual({});
    });

    test('does not mutate the caller-supplied config object', () => {
        const stored = {
            type: 'api-key',
            config: { keyName: 'X-API-Key', keyValue: 'secret', location: 'query' }
        };

        authManager.loadAuthConfig(stored);

        expect(stored.config.location).toBe('query');
    });

    test('defaults to header when a fresh api-key auth is selected', () => {
        authManager.handleAuthTypeChange('api-key');

        expect(authManager.getAuthConfig().config.location).toBe('header');
        expect(document.getElementById('api-key-location').value).toBe('header');
    });

    test('still defaults to header when a stored config omits the location', () => {
        authManager.loadAuthConfig({
            type: 'api-key',
            config: { keyName: 'X-API-Key', keyValue: 'secret' }
        });

        expect(authManager.getAuthConfig().config.location).toBe('header');
    });
});
