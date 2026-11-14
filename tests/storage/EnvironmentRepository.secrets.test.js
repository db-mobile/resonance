import { EnvironmentRepository } from '../../src/modules/storage/EnvironmentRepository.js';
import { SecretStore } from '../../src/modules/storage/SecretStore.js';

describe('EnvironmentRepository secret handling', () => {
    let repository;
    let secretStore;
    let backing;
    let mockBackendAPI;

    const seedEnvironment = (overrides = {}) => {
        backing.environments = {
            items: [
                {
                    id: 'env_1',
                    name: 'Dev',
                    variables: { baseUrl: 'http://localhost' },
                    color: null,
                    ...overrides
                }
            ],
            activeEnvironmentId: 'env_1'
        };
    };

    beforeEach(() => {
        backing = {};
        mockBackendAPI = {
            store: {
                get: jest.fn(async (key) => backing[key] ?? null),
                set: jest.fn(async (key, value) => { backing[key] = value; })
            }
        };
        secretStore = new SecretStore(mockBackendAPI);
        repository = new EnvironmentRepository(mockBackendAPI, secretStore);
    });

    test('normalizes secretKeys, dropping names without a backing variable', async () => {
        seedEnvironment({ secretKeys: ['baseUrl', 'ghost', 'baseUrl'] });
        const env = await repository.getEnvironmentById('env_1');
        expect(env.secretKeys).toEqual(['baseUrl']);
    });

    test('applyVariableChanges keeps secrets secret, writes plaintext and deletes nulls in one save', async () => {
        seedEnvironment({ variables: { baseUrl: 'http://localhost', token: '', stale: 'x' }, secretKeys: ['token'] });
        await repository.getAllEnvironments();
        mockBackendAPI.store.set.mockClear();

        await repository.applyVariableChanges('env_1', { token: 'fresh-jwt', baseUrl: 'http://staging', stale: null });

        const env = await repository.getEnvironmentById('env_1');
        expect(env.variables).toEqual({ baseUrl: 'http://staging', token: '' });
        expect(env.secretKeys).toEqual(['token']);
        expect(await secretStore.get('env:env_1', 'token')).toBe('fresh-jwt');
        const environmentWrites = mockBackendAPI.store.set.mock.calls.filter(([key]) => key === 'environments');
        expect(environmentWrites).toHaveLength(1);
    });

    test('setEnvironmentVariable with isSecret stores value out of band and masks placeholder', async () => {
        seedEnvironment();
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'super-secret', true);

        const env = await repository.getEnvironmentById('env_1');
        expect(env.secretKeys).toContain('apiKey');
        expect(env.variables.apiKey).toBe('');
        expect(await secretStore.get('env:env_1', 'apiKey')).toBe('super-secret');
    });

    test('setEnvironmentVariable without isSecret stores inline and drops prior secret', async () => {
        seedEnvironment();
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'secret', true);
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'plain', false);

        const env = await repository.getEnvironmentById('env_1');
        expect(env.secretKeys).not.toContain('apiKey');
        expect(env.variables.apiKey).toBe('plain');
        expect(await secretStore.has('env:env_1', 'apiKey')).toBe(false);
    });

    test('getActiveEnvironmentVariables hydrates secret values', async () => {
        seedEnvironment();
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'super-secret', true);

        const vars = await repository.getActiveEnvironmentVariables();
        expect(vars.apiKey).toBe('super-secret');
        expect(vars.baseUrl).toBe('http://localhost');
    });

    test('editor read paths keep secret values masked', async () => {
        seedEnvironment();
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'super-secret', true);

        const env = await repository.getEnvironmentById('env_1');
        expect(env.variables.apiKey).toBe('');
    });

    test('deleteEnvironmentVariable removes the secret value too', async () => {
        seedEnvironment();
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'super-secret', true);
        await repository.deleteEnvironmentVariable('env_1', 'apiKey');

        const env = await repository.getEnvironmentById('env_1');
        expect(env.variables.apiKey).toBeUndefined();
        expect(env.secretKeys).not.toContain('apiKey');
        expect(await secretStore.has('env:env_1', 'apiKey')).toBe(false);
    });

    test('deleting an environment clears its secret scope', async () => {
        backing.environments = {
            items: [
                { id: 'env_1', name: 'Dev', variables: {}, color: null },
                { id: 'env_2', name: 'Prod', variables: {}, color: null }
            ],
            activeEnvironmentId: 'env_1'
        };
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'secret', true);
        await repository.deleteEnvironment('env_1');
        expect(await secretStore.has('env:env_1', 'apiKey')).toBe(false);
    });

    test('duplicating an environment copies secret flags and values', async () => {
        seedEnvironment();
        await repository.setEnvironmentVariable('env_1', 'apiKey', 'super-secret', true);

        const copy = await repository.duplicateEnvironment('env_1', 'Dev Copy');
        expect(copy.secretKeys).toContain('apiKey');
        expect(await secretStore.get(`env:${copy.id}`, 'apiKey')).toBe('super-secret');
        expect(copy.variables.apiKey).toBe('');
    });
});

describe('EnvironmentRepository bulk import keeps secrets out of the store', () => {
    let repository;
    let secretStore;
    let backing;

    beforeEach(() => {
        backing = {};
        const api = {
            store: {
                get: jest.fn(async (key) => backing[key] ?? null),
                set: jest.fn(async (key, value) => { backing[key] = value; })
            }
        };
        secretStore = new SecretStore(api);
        repository = new EnvironmentRepository(api, secretStore);
    });

    const imported = {
        items: [{ name: 'Prod', variables: { host: 'api.test', apiKey: 'k-1' }, secretKeys: ['apiKey'] }]
    };

    test.each([false, true])('merge=%s stores the secret value in the keychain only', async (merge) => {
        await repository.importEnvironments(imported, merge);

        const env = backing.environments.items.find(item => item.name === 'Prod');
        expect(env.variables).toEqual({ host: 'api.test', apiKey: '' });
        expect(env.secretKeys).toEqual(['apiKey']);
        expect(await secretStore.get(`env:${env.id}`, 'apiKey')).toBe('k-1');
    });

    test('replacing all environments removes the secret scopes of the replaced ones', async () => {
        backing.environments = {
            items: [{ id: 'old', name: 'Old', variables: { token: '' }, secretKeys: ['token'] }],
            activeEnvironmentId: 'old'
        };
        await secretStore.set('env:old', 'token', 't-0');

        await repository.importEnvironments(imported, false);

        expect(await secretStore.has('env:old', 'token')).toBe(false);
    });
});
