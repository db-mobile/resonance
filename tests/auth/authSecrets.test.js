import {
    SECRET_AUTH_FIELDS,
    getSecretAuthFields,
    splitAuthSecrets,
    mergeAuthSecrets,
    authSecretScope
} from '../../src/modules/auth/authSecrets.js';

describe('authSecrets', () => {
    describe('getSecretAuthFields', () => {
        test('returns the field list for known types', () => {
            expect(getSecretAuthFields('bearer')).toEqual(['token']);
            expect(getSecretAuthFields('aws-v4')).toEqual(SECRET_AUTH_FIELDS['aws-v4']);
        });

        test('returns [] for unknown or missing types', () => {
            expect(getSecretAuthFields('none')).toEqual([]);
            expect(getSecretAuthFields(undefined)).toEqual([]);
        });
    });

    describe('splitAuthSecrets', () => {
        test('extracts a literal secret and blanks it on the redacted copy', () => {
            const cfg = { type: 'bearer', config: { token: 'sk-live-123' } };
            const { redacted, secrets } = splitAuthSecrets(cfg);

            expect(secrets).toEqual({ token: 'sk-live-123' });
            expect(redacted.config.token).toBe('');
            // original is not mutated
            expect(cfg.config.token).toBe('sk-live-123');
        });

        test('leaves template references on disk', () => {
            const cfg = { type: 'bearer', config: { token: '{{bearerToken}}' } };
            const { redacted, secrets } = splitAuthSecrets(cfg);

            expect(secrets).toEqual({});
            expect(redacted.config.token).toBe('{{bearerToken}}');
        });

        test('ignores empty fields', () => {
            const cfg = { type: 'basic', config: { username: 'u', password: '' } };
            const { redacted, secrets } = splitAuthSecrets(cfg);

            expect(secrets).toEqual({});
            expect(redacted.config.password).toBe('');
        });

        test('handles multiple secret fields (oauth2)', () => {
            const cfg = {
                type: 'oauth2',
                config: { clientId: 'id', clientSecret: 'shh', token: 'tok', refreshToken: '{{rt}}' }
            };
            const { redacted, secrets } = splitAuthSecrets(cfg);

            expect(secrets).toEqual({ clientSecret: 'shh', token: 'tok' });
            expect(redacted.config.clientSecret).toBe('');
            expect(redacted.config.token).toBe('');
            expect(redacted.config.refreshToken).toBe('{{rt}}');
            expect(redacted.config.clientId).toBe('id');
        });

        test('passes through configs with no secret fields', () => {
            const cfg = { type: 'none', config: {} };
            expect(splitAuthSecrets(cfg)).toEqual({ redacted: cfg, secrets: {} });
        });

        test('tolerates null/!object input', () => {
            expect(splitAuthSecrets(null)).toEqual({ redacted: null, secrets: {} });
        });
    });

    describe('mergeAuthSecrets', () => {
        test('fills blanked fields from secrets', () => {
            const cfg = { type: 'bearer', config: { token: '' } };
            const merged = mergeAuthSecrets(cfg, { token: 'sk-live-123' });
            expect(merged.config.token).toBe('sk-live-123');
        });

        test('does not clobber a template reference left on disk', () => {
            const cfg = { type: 'bearer', config: { token: '{{bearerToken}}' } };
            const merged = mergeAuthSecrets(cfg, { token: 'sk-live-123' });
            expect(merged.config.token).toBe('{{bearerToken}}');
        });

        test('returns the same config when there are no secrets', () => {
            const cfg = { type: 'bearer', config: { token: '' } };
            expect(mergeAuthSecrets(cfg, {})).toBe(cfg);
        });
    });

    describe('round-trip', () => {
        test('split then merge restores the original literal value', () => {
            const cfg = { type: 'basic', config: { username: 'u', password: 'p@ss' } };
            const { redacted, secrets } = splitAuthSecrets(cfg);
            const restored = mergeAuthSecrets(redacted, secrets);
            expect(restored.config).toEqual({ username: 'u', password: 'p@ss' });
        });
    });

    describe('authSecretScope', () => {
        test('builds a stable scope string', () => {
            expect(authSecretScope('c1', 'e1')).toBe('auth:c1:e1');
        });
    });
});
