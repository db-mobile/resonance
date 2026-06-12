import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';
import { SecretStore } from '../../src/modules/storage/SecretStore.js';

describe('CollectionRepository auth secret redaction', () => {
    let repository;
    let secretStore;
    let backing;
    let savedEndpoint;
    let mockBackendAPI;

    beforeEach(() => {
        backing = {};
        savedEndpoint = {};
        mockBackendAPI = {
            collections: {
                getEndpointData: jest.fn(async () => ({ authConfig: savedEndpoint.authConfig ?? null })),
                saveEndpointData: jest.fn(async (_c, _e, data) => { savedEndpoint = data; }),
                deleteEndpointData: jest.fn().mockResolvedValue(undefined)
            },
            store: {
                get: jest.fn(async (key) => backing[key] ?? null),
                set: jest.fn(async (key, value) => { backing[key] = value; })
            }
        };
        secretStore = new SecretStore(mockBackendAPI);
        repository = new CollectionRepository(mockBackendAPI, secretStore);
    });

    test('literal credentials are kept out of the persisted (git-friendly) file', async () => {
        await repository.savePersistedAuthConfig('c1', 'e1', {
            type: 'bearer',
            config: { token: 'sk-live-abc' }
        });

        // What gets written to disk must not contain the literal secret
        expect(savedEndpoint.authConfig.config.token).toBe('');
        // The real value lives in the SecretStore
        expect(await secretStore.get('auth:c1:e1', 'token')).toBe('sk-live-abc');
    });

    test('getPersistedAuthConfig rehydrates the credential', async () => {
        await repository.savePersistedAuthConfig('c1', 'e1', {
            type: 'bearer',
            config: { token: 'sk-live-abc' }
        });

        const loaded = await repository.getPersistedAuthConfig('c1', 'e1');
        expect(loaded.config.token).toBe('sk-live-abc');
    });

    test('template references are preserved on disk and not stored as secrets', async () => {
        await repository.savePersistedAuthConfig('c1', 'e1', {
            type: 'bearer',
            config: { token: '{{bearerToken}}' }
        });

        expect(savedEndpoint.authConfig.config.token).toBe('{{bearerToken}}');
        expect(await secretStore.has('auth:c1:e1', 'token')).toBe(false);
    });

    test('switching a field from literal to template drops the stale stored secret', async () => {
        await repository.savePersistedAuthConfig('c1', 'e1', {
            type: 'bearer',
            config: { token: 'sk-live-abc' }
        });
        expect(await secretStore.has('auth:c1:e1', 'token')).toBe(true);

        await repository.savePersistedAuthConfig('c1', 'e1', {
            type: 'bearer',
            config: { token: '{{bearerToken}}' }
        });
        expect(await secretStore.has('auth:c1:e1', 'token')).toBe(false);
    });

    test('deleting endpoint data clears its auth secret scope', async () => {
        await repository.savePersistedAuthConfig('c1', 'e1', {
            type: 'basic',
            config: { username: 'u', password: 'p@ss' }
        });
        expect(await secretStore.has('auth:c1:e1', 'password')).toBe(true);

        await repository.deletePersistedEndpointData('c1', 'e1');
        expect(await secretStore.has('auth:c1:e1', 'password')).toBe(false);
    });

    test('deleting a collection clears all its endpoint auth scopes', async () => {
        mockBackendAPI.collections.delete = jest.fn().mockResolvedValue(undefined);
        await repository.savePersistedAuthConfig('c1', 'e1', { type: 'bearer', config: { token: 't1' } });
        await repository.savePersistedAuthConfig('c1', 'e2', { type: 'bearer', config: { token: 't2' } });

        await repository.delete('c1');
        expect(await secretStore.has('auth:c1:e1', 'token')).toBe(false);
        expect(await secretStore.has('auth:c1:e2', 'token')).toBe(false);
    });
});
