import fs from 'fs';
import path from 'path';
import { AUTH_TYPES, getAuthType, getAuthTypeLabel, getSecretAuthFields } from '../../src/modules/auth/authTypes.js';
import { SECRET_AUTH_FIELDS } from '../../src/modules/auth/authSecrets.js';

const TEMPLATE_HTML = fs.readFileSync(path.join(process.cwd(), 'src/templates/auth/authFields.html'), 'utf8');

describe('AUTH_TYPES registry', () => {
    test('lists every auth type exactly once with its label', () => {
        expect(Object.fromEntries(AUTH_TYPES.map((entry) => [entry.id, entry.label]))).toEqual({
            none: 'No Auth',
            inherit: 'Inherit from Parent',
            bearer: 'Bearer Token',
            basic: 'Basic Auth',
            'api-key': 'API Key',
            oauth2: 'OAuth 2.0',
            digest: 'Digest Auth',
            ntlm: 'NTLM',
            'aws-v4': 'AWS Signature'
        });
    });

    test('every template an entry names exists in the auth template file', () => {
        for (const entry of AUTH_TYPES) {
            if (entry.template) {
                expect(TEMPLATE_HTML).toContain(`id="${entry.template}"`);
            }
            if (entry.fields.length > 0) {
                expect(entry.template).not.toBeNull();
            }
        }
    });

    test('every bound field has an element in its template', () => {
        for (const entry of AUTH_TYPES) {
            for (const field of entry.fields) {
                expect(TEMPLATE_HTML).toContain(`id="${field.id}"`);
            }
        }
    });

    test('secret fields match the redaction table', () => {
        expect(SECRET_AUTH_FIELDS).toEqual({
            bearer: ['token'],
            basic: ['password'],
            'api-key': ['keyValue'],
            oauth2: ['clientSecret', 'password', 'token', 'refreshToken'],
            digest: ['password'],
            ntlm: ['password'],
            'aws-v4': ['secretAccessKey', 'sessionToken']
        });
        expect(getSecretAuthFields('oauth2')).toEqual(['clientSecret', 'password', 'token', 'refreshToken']);
        expect(getSecretAuthFields('none')).toEqual([]);
        expect(getSecretAuthFields('nope')).toEqual([]);
    });

    test('lookups fall back safely and the entries are frozen', () => {
        expect(getAuthType('nope')).toBeNull();
        expect(getAuthType(undefined)).toBeNull();
        expect(getAuthTypeLabel('nope')).toBe('nope');
        expect(Object.isFrozen(getAuthType('bearer'))).toBe(true);
        expect(Object.isFrozen(getAuthType('bearer').fields)).toBe(true);
    });

    test('only inherit and oauth2 bring their own renderer', () => {
        expect(AUTH_TYPES.filter((entry) => entry.mount).map((entry) => [entry.id, entry.mount])).toEqual([
            ['inherit', 'renderInheritFields'],
            ['oauth2', 'renderOAuth2Fields']
        ]);
    });
});
