import { VariableRepository } from '../../src/modules/storage/VariableRepository.js';
import { SecretStore } from '../../src/modules/storage/SecretStore.js';

describe('VariableRepository secret handling', () => {
    let repository;
    let secretStore;
    let backing;
    let savedVariables;
    let mockBackendAPI;

    beforeEach(() => {
        backing = {};
        savedVariables = null;
        mockBackendAPI = {
            collections: {
                getVariables: jest.fn(async () => savedVariables ?? []),
                saveVariables: jest.fn(async (_id, vars) => { savedVariables = vars; })
            },
            store: {
                get: jest.fn(async (key) => backing[key] ?? null),
                set: jest.fn(async (key, value) => { backing[key] = value; })
            }
        };
        secretStore = new SecretStore(mockBackendAPI);
        repository = new VariableRepository(mockBackendAPI, secretStore);
    });

    test('secret values are kept out of the saved (git-friendly) variables array', async () => {
        await repository.setVariablesForCollection(
            'c1',
            { baseUrl: 'http://x', apiKey: 'super-secret' },
            ['apiKey']
        );

        const apiKeyEntry = savedVariables.find(e => e.key === 'apiKey');
        expect(apiKeyEntry).toEqual({ key: 'apiKey', value: '', secret: true });
        // non-secret entry keeps its value
        expect(savedVariables.find(e => e.key === 'baseUrl')).toEqual({ key: 'baseUrl', value: 'http://x' });
        // real value lives in the SecretStore
        expect(await secretStore.get('collvar:c1', 'apiKey')).toBe('super-secret');
    });

    test('getVariablesForCollection hydrates secret values for resolution', async () => {
        await repository.setVariablesForCollection('c1', { apiKey: 'super-secret' }, ['apiKey']);
        repository.invalidateCache('c1');

        const vars = await repository.getVariablesForCollection('c1');
        expect(vars.apiKey).toBe('super-secret');
    });

    test('getVariableEntriesForCollection returns secret flag and resolved value', async () => {
        await repository.setVariablesForCollection(
            'c1',
            { baseUrl: 'http://x', apiKey: 'super-secret' },
            ['apiKey']
        );

        const entries = await repository.getVariableEntriesForCollection('c1');
        const byName = Object.fromEntries(entries.map(e => [e.name, e]));
        expect(byName.apiKey).toEqual({ name: 'apiKey', value: 'super-secret', secret: true });
        expect(byName.baseUrl).toEqual({ name: 'baseUrl', value: 'http://x', secret: false });
    });

    test('unmarking a variable as secret drops the stored secret and inlines the value', async () => {
        await repository.setVariablesForCollection('c1', { apiKey: 'super-secret' }, ['apiKey']);
        await repository.setVariablesForCollection('c1', { apiKey: 'now-plain' }, []);

        expect(await secretStore.has('collvar:c1', 'apiKey')).toBe(false);
        expect(savedVariables.find(e => e.key === 'apiKey')).toEqual({ key: 'apiKey', value: 'now-plain' });
    });

    test('removing a secret variable prunes its stored value', async () => {
        await repository.setVariablesForCollection('c1', { apiKey: 'super-secret', keep: 'v' }, ['apiKey']);
        await repository.setVariablesForCollection('c1', { keep: 'v' }, []);

        expect(await secretStore.has('collvar:c1', 'apiKey')).toBe(false);
    });

    test('single setVariable preserves existing secret flags', async () => {
        await repository.setVariablesForCollection('c1', { apiKey: 'super-secret' }, ['apiKey']);
        repository.invalidateCache('c1');

        await repository.setVariable('c1', 'baseUrl', 'http://x');

        // apiKey must still be secret (value out of band), baseUrl inline
        expect(savedVariables.find(e => e.key === 'apiKey')).toEqual({ key: 'apiKey', value: '', secret: true });
        expect(savedVariables.find(e => e.key === 'baseUrl')).toEqual({ key: 'baseUrl', value: 'http://x' });
        expect(await secretStore.get('collvar:c1', 'apiKey')).toBe('super-secret');
    });

    test('deleteAllVariablesForCollection clears the secret scope', async () => {
        await repository.setVariablesForCollection('c1', { apiKey: 'super-secret' }, ['apiKey']);
        await repository.deleteAllVariablesForCollection('c1');
        expect(await secretStore.has('collvar:c1', 'apiKey')).toBe(false);
    });
});
