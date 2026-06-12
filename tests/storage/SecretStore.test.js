import { SecretStore } from '../../src/modules/storage/SecretStore.js';

describe('SecretStore', () => {
    let store;
    let backing;
    let mockBackendAPI;

    beforeEach(() => {
        backing = {};
        mockBackendAPI = {
            store: {
                get: jest.fn(async (key) => backing[key] ?? null),
                set: jest.fn(async (key, value) => { backing[key] = value; })
            }
        };
        store = new SecretStore(mockBackendAPI);
    });

    test('set then get returns the stored value', async () => {
        await store.set('env:1', 'token', 'abc123');
        expect(await store.get('env:1', 'token')).toBe('abc123');
    });

    test('get returns undefined for unknown scope/key', async () => {
        expect(await store.get('env:1', 'missing')).toBeUndefined();
    });

    test('has reports presence', async () => {
        await store.set('env:1', 'token', 'abc');
        expect(await store.has('env:1', 'token')).toBe(true);
        expect(await store.has('env:1', 'other')).toBe(false);
        expect(await store.has('env:2', 'token')).toBe(false);
    });

    test('getScope returns a copy of all secrets in a scope', async () => {
        await store.set('env:1', 'a', '1');
        await store.set('env:1', 'b', '2');
        const scope = await store.getScope('env:1');
        expect(scope).toEqual({ a: '1', b: '2' });
        scope.a = 'mutated';
        expect(await store.get('env:1', 'a')).toBe('1');
    });

    test('delete removes a key and prunes empty scopes', async () => {
        await store.set('env:1', 'a', '1');
        await store.delete('env:1', 'a');
        expect(await store.has('env:1', 'a')).toBe(false);
        expect(backing.secretValues['env:1']).toBeUndefined();
    });

    test('rename preserves the value under a new key', async () => {
        await store.set('env:1', 'old', 'v');
        await store.rename('env:1', 'old', 'new');
        expect(await store.get('env:1', 'old')).toBeUndefined();
        expect(await store.get('env:1', 'new')).toBe('v');
    });

    test('deleteScope removes the whole scope', async () => {
        await store.set('env:1', 'a', '1');
        await store.set('env:2', 'b', '2');
        await store.deleteScope('env:1');
        expect(await store.has('env:1', 'a')).toBe(false);
        expect(await store.has('env:2', 'b')).toBe(true);
    });

    test('deleteScopePrefix removes all matching scopes', async () => {
        await store.set('auth:c1:e1', 'token', 't1');
        await store.set('auth:c1:e2', 'token', 't2');
        await store.set('auth:c2:e1', 'token', 't3');
        await store.deleteScopePrefix('auth:c1:');
        expect(await store.has('auth:c1:e1', 'token')).toBe(false);
        expect(await store.has('auth:c1:e2', 'token')).toBe(false);
        expect(await store.has('auth:c2:e1', 'token')).toBe(true);
    });

    test('tolerates a non-object persisted value', async () => {
        backing.secretValues = ['unexpected'];
        store = new SecretStore(mockBackendAPI);
        expect(await store.get('env:1', 'token')).toBeUndefined();
        await store.set('env:1', 'token', 'x');
        expect(await store.get('env:1', 'token')).toBe('x');
    });
});
