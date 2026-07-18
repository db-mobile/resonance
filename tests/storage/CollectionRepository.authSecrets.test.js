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

    describe('collection-level auth', () => {
        let savedCollection;

        beforeEach(() => {
            savedCollection = { id: 'c1', name: 'Test' };
            mockBackendAPI.collections.get = jest.fn(async () => savedCollection);
            mockBackendAPI.collections.save = jest.fn(async (collection) => {
                savedCollection = collection;
            });
            mockBackendAPI.collections.delete = jest.fn().mockResolvedValue(undefined);
        });

        test('saveCollectionAuthConfig keeps literal credentials out of collection.json', async () => {
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-live-abc' }
            });

            expect(savedCollection.authConfig.config.token).toBe('');
            expect(await secretStore.get('auth:c1:__collection__', 'token')).toBe('sk-live-abc');
        });

        test('getCollectionAuthConfig rehydrates the credential', async () => {
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-live-abc' }
            });
            repository._byIdCache.clear();

            const loaded = await repository.getCollectionAuthConfig('c1');
            expect(loaded.type).toBe('bearer');
            expect(loaded.config.token).toBe('sk-live-abc');
        });

        test('template references stay on disk and out of the SecretStore', async () => {
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: '{{token}}' }
            });

            expect(savedCollection.authConfig.config.token).toBe('{{token}}');
            expect(await secretStore.has('auth:c1:__collection__', 'token')).toBe(false);
        });

        test('switching auth type drops stale collection-scope secrets', async () => {
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-live-abc' }
            });
            expect(await secretStore.has('auth:c1:__collection__', 'token')).toBe(true);

            await repository.saveCollectionAuthConfig('c1', {
                type: 'basic',
                config: { username: 'u', password: 'p@ss' }
            });
            expect(await secretStore.has('auth:c1:__collection__', 'token')).toBe(false);
            expect(await secretStore.get('auth:c1:__collection__', 'password')).toBe('p@ss');
        });

        test('deleting a collection clears the collection auth scope too', async () => {
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-live-abc' }
            });

            await repository.delete('c1');
            expect(await secretStore.has('auth:c1:__collection__', 'token')).toBe(false);
        });

        test('getCollectionAuthConfig returns null when the collection has no auth', async () => {
            const loaded = await repository.getCollectionAuthConfig('c1');
            expect(loaded).toBeNull();
        });
    });

    describe('folder-level auth', () => {
        let savedCollection;

        beforeEach(() => {
            savedCollection = {
                id: 'c1',
                name: 'Test',
                folders: [
                    { id: 'f1', name: 'albums', endpoints: [{ id: 'e1' }] },
                    { id: 'f2', name: 'posts', endpoints: [{ id: 'e2' }] }
                ]
            };
            mockBackendAPI.collections.get = jest.fn(async () => savedCollection);
            mockBackendAPI.collections.save = jest.fn(async (collection) => {
                savedCollection = collection;
            });
        });

        test('saveFolderAuthConfig redacts the folder copy and scopes secrets per folder', async () => {
            await repository.saveFolderAuthConfig('c1', 'f1', {
                type: 'bearer',
                config: { token: 'sk-folder' }
            });

            const folder = savedCollection.folders.find((f) => f.id === 'f1');
            expect(folder.authConfig.config.token).toBe('');
            expect(await secretStore.get('auth:c1:__folder__:f1', 'token')).toBe('sk-folder');
            expect(savedCollection.folders.find((f) => f.id === 'f2').authConfig).toBeUndefined();
        });

        test('getFolderAuthConfig rehydrates the credential', async () => {
            await repository.saveFolderAuthConfig('c1', 'f1', {
                type: 'bearer',
                config: { token: 'sk-folder' }
            });
            repository._byIdCache.clear();

            const loaded = await repository.getFolderAuthConfig('c1', 'f1');
            expect(loaded.config.token).toBe('sk-folder');
        });

        test('getInheritedAuthConfig prefers folder auth for its endpoints', async () => {
            await repository.saveFolderAuthConfig('c1', 'f1', {
                type: 'bearer',
                config: { token: 'sk-folder' }
            });
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-collection' }
            });
            repository._byIdCache.clear();

            const forFolderEndpoint = await repository.getInheritedAuthConfig('c1', 'e1');
            expect(forFolderEndpoint.config.token).toBe('sk-folder');

            const forOtherEndpoint = await repository.getInheritedAuthConfig('c1', 'e2');
            expect(forOtherEndpoint.config.token).toBe('sk-collection');
        });

        test('a folder auth of explicit none opts its endpoints out', async () => {
            await repository.saveFolderAuthConfig('c1', 'f1', { type: 'none', config: {} });
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-collection' }
            });
            repository._byIdCache.clear();

            const resolved = await repository.getInheritedAuthConfig('c1', 'e1');
            expect(resolved.type).toBe('none');
        });

        test('a folder auth of inherit falls through to collection auth', async () => {
            await repository.saveFolderAuthConfig('c1', 'f1', { type: 'inherit', config: {} });
            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-collection' }
            });
            repository._byIdCache.clear();

            const resolved = await repository.getInheritedAuthConfig('c1', 'e1');
            expect(resolved.config.token).toBe('sk-collection');
        });

        test('auth edits saved via one repository instance are visible to another', async () => {
            const otherRepository = new CollectionRepository(mockBackendAPI, secretStore);
            await otherRepository.getInheritedAuthConfig('c1', 'e1');

            await repository.saveCollectionAuthConfig('c1', {
                type: 'basic',
                config: { username: 'u', password: 'p@ss' }
            });
            let resolved = await otherRepository.getInheritedAuthConfig('c1', 'e1');
            expect(resolved.type).toBe('basic');

            await repository.saveCollectionAuthConfig('c1', {
                type: 'bearer',
                config: { token: 'sk-new' }
            });
            resolved = await otherRepository.getInheritedAuthConfig('c1', 'e1');
            expect(resolved.type).toBe('bearer');
            expect(resolved.config.token).toBe('sk-new');
        });

        test('folder auth edits are also visible across repository instances', async () => {
            const otherRepository = new CollectionRepository(mockBackendAPI, secretStore);
            await otherRepository.getInheritedAuthConfig('c1', 'e1');

            await repository.saveFolderAuthConfig('c1', 'f1', {
                type: 'bearer',
                config: { token: 'sk-folder' }
            });

            const resolved = await otherRepository.getInheritedAuthConfig('c1', 'e1');
            expect(resolved.type).toBe('bearer');
            expect(resolved.config.token).toBe('sk-folder');
        });

        test('deleting a collection prunes folder auth scopes too', async () => {
            mockBackendAPI.collections.delete = jest.fn().mockResolvedValue(undefined);
            await repository.saveFolderAuthConfig('c1', 'f1', {
                type: 'bearer',
                config: { token: 'sk-folder' }
            });

            await repository.delete('c1');
            expect(await secretStore.has('auth:c1:__folder__:f1', 'token')).toBe(false);
        });
    });
});
