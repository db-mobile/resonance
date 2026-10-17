import { withBearerFallback } from '../../src/modules/auth/authVariables.js';

describe('withBearerFallback', () => {
    test('fills an empty bearer token from the bearerToken variable', () => {
        const auth = { type: 'bearer', config: { token: '' } };

        expect(withBearerFallback(auth, { bearerToken: 'abc' })).toEqual({ type: 'bearer', config: { token: '{{bearerToken}}' } });
        expect(auth.config.token).toBe('');
    });

    test('returns the same config when a token is set, the type differs or no variable exists', () => {
        const bearer = { type: 'bearer', config: { token: 'set' } };
        const basic = { type: 'basic', config: {} };
        const empty = { type: 'bearer', config: {} };

        expect(withBearerFallback(bearer, { bearerToken: 'abc' })).toBe(bearer);
        expect(withBearerFallback(basic, { bearerToken: 'abc' })).toBe(basic);
        expect(withBearerFallback(empty, {})).toBe(empty);
        expect(withBearerFallback(null, { bearerToken: 'abc' })).toBeNull();
    });
});
