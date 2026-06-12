import { SecretStore } from '../../src/modules/storage/SecretStore.js';

/**
 * Builds a mock backendAPI with a store and an optional in-memory keychain.
 *
 * @param {Object} opts
 * @param {boolean} opts.keychain - Whether a keychain is available
 * @param {Object} [opts.seedStore] - Initial store contents
 */
function makeBackend({ keychain, seedStore = {} }) {
    const store = { ...seedStore };
    const chain = new Map(); // account -> value
    const api = {
        store: {
            get: jest.fn(async (key) => (key in store ? store[key] : null)),
            set: jest.fn(async (key, value) => { store[key] = value; })
        },
        __store: store,
        __chain: chain
    };
    if (keychain) {
        api.secrets = {
            keychainAvailable: jest.fn().mockResolvedValue(true),
            get: jest.fn(async (account) => (chain.has(account) ? chain.get(account) : null)),
            set: jest.fn(async (account, value) => { chain.set(account, value); }),
            delete: jest.fn(async (account) => { chain.delete(account); })
        };
    }
    return api;
}

describe('SecretStore keychain backend', () => {
    test('uses the keychain when available: values go to keychain, not the plaintext store', async () => {
        const api = makeBackend({ keychain: true });
        const store = new SecretStore(api);

        await store.set('env:1', 'token', 'sk-live-123');

        expect(api.__chain.get('env:1|token')).toBe('sk-live-123');
        expect(await store.get('env:1', 'token')).toBe('sk-live-123');
        // plaintext secretValues must stay empty; only a non-sensitive index is stored
        expect(api.__store.secretValues).toBeUndefined();
        expect(api.__store.secretIndex).toEqual({ 'env:1': { token: true } });
    });

    test('getScope reads all keys from the keychain', async () => {
        const api = makeBackend({ keychain: true });
        const store = new SecretStore(api);
        await store.set('auth:c1:e1', 'token', 't');
        await store.set('auth:c1:e1', 'password', 'p');

        expect(await store.getScope('auth:c1:e1')).toEqual({ token: 't', password: 'p' });
    });

    test('delete removes the value and index entry', async () => {
        const api = makeBackend({ keychain: true });
        const store = new SecretStore(api);
        await store.set('env:1', 'a', '1');
        await store.delete('env:1', 'a');

        expect(api.__chain.has('env:1|a')).toBe(false);
        expect(await store.has('env:1', 'a')).toBe(false);
        expect(api.__store.secretIndex['env:1']).toBeUndefined();
    });

    test('deleteScopePrefix removes matching scopes from keychain and index', async () => {
        const api = makeBackend({ keychain: true });
        const store = new SecretStore(api);
        await store.set('auth:c1:e1', 'token', 't1');
        await store.set('auth:c1:e2', 'token', 't2');
        await store.set('auth:c2:e1', 'token', 't3');

        await store.deleteScopePrefix('auth:c1:');

        expect(api.__chain.has('auth:c1:e1|token')).toBe(false);
        expect(api.__chain.has('auth:c1:e2|token')).toBe(false);
        expect(api.__chain.has('auth:c2:e1|token')).toBe(true);
    });

    test('rename moves the value to a new key', async () => {
        const api = makeBackend({ keychain: true });
        const store = new SecretStore(api);
        await store.set('env:1', 'old', 'v');
        await store.rename('env:1', 'old', 'new');

        expect(await store.get('env:1', 'old')).toBeUndefined();
        expect(await store.get('env:1', 'new')).toBe('v');
    });

    test('migrates pre-existing plaintext secrets into the keychain then clears them', async () => {
        const api = makeBackend({
            keychain: true,
            seedStore: { secretValues: { 'env:1': { token: 'legacy-secret' } } }
        });
        const store = new SecretStore(api);

        // First access triggers migration
        const value = await store.get('env:1', 'token');

        expect(value).toBe('legacy-secret');
        expect(api.__chain.get('env:1|token')).toBe('legacy-secret');
        expect(api.__store.secretValues).toEqual({}); // plaintext cleared
        expect(api.__store.secretIndex).toEqual({ 'env:1': { token: true } });
    });
});

describe('SecretStore fallback (no keychain)', () => {
    test('falls back to plaintext store and warns once', async () => {
        const api = makeBackend({ keychain: false });
        const onFallback = jest.fn();
        const store = new SecretStore(api, { onFallback });

        await store.set('env:1', 'token', 'plain');

        expect(await store.get('env:1', 'token')).toBe('plain');
        expect(api.__store.secretValues).toEqual({ 'env:1': { token: 'plain' } });
        // multiple operations -> warning only fires once
        await store.set('env:1', 'token2', 'plain2');
        expect(onFallback).toHaveBeenCalledTimes(1);
    });

    test('keychainAvailable returning false (e.g. locked) uses fallback', async () => {
        const api = makeBackend({ keychain: true });
        api.secrets.keychainAvailable.mockResolvedValue(false);
        const store = new SecretStore(api);

        await store.set('env:1', 'token', 'plain');
        expect(api.__store.secretValues).toEqual({ 'env:1': { token: 'plain' } });
        expect(api.__chain.size).toBe(0);
    });
});
