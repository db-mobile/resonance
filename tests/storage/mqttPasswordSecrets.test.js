import { WorkspaceTabRepository } from '../../src/modules/storage/WorkspaceTabRepository.js';
import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';
import { SecretStore } from '../../src/modules/storage/SecretStore.js';

function makeBackend() {
    const store = {};
    const chain = new Map();
    const endpointData = {};
    return {
        store: {
            get: jest.fn(async (key) => (key in store ? store[key] : null)),
            set: jest.fn(async (key, value) => { store[key] = value; })
        },
        secrets: {
            keychainAvailable: jest.fn().mockResolvedValue(true),
            get: jest.fn(async (account) => (chain.has(account) ? chain.get(account) : null)),
            set: jest.fn(async (account, value) => { chain.set(account, value); }),
            delete: jest.fn(async (account) => { chain.delete(account); })
        },
        collections: {
            getEndpointData: jest.fn(async (c, e) => endpointData[`${c}/${e}`] || {}),
            saveEndpointData: jest.fn(async (c, e, data) => { endpointData[`${c}/${e}`] = data; })
        },
        __store: store,
        __chain: chain,
        __endpointData: endpointData
    };
}

const mqttTab = (id, password) => ({
    id,
    name: 'MQTT',
    request: { protocol: 'mqtt', broker: 'mqtt://b', username: 'u', password },
    response: {},
    endpoint: null
});

describe('workspace tabs keep the MQTT password out of the plaintext store', () => {
    test('the persisted tab has no password; the keychain has it; reload restores it', async () => {
        const api = makeBackend();
        const repo = new WorkspaceTabRepository(api, new SecretStore(api));

        await repo.saveTabs([mqttTab('t1', 'hunter2')]);

        expect(api.__store['workspace-tabs'][0].request.password).toBe('');
        expect(api.__chain.get('tab:t1|mqttPassword')).toBe('hunter2');

        const reloaded = new WorkspaceTabRepository(api, new SecretStore(api));
        const tabs = await reloaded.getTabs();
        expect(tabs[0].request.password).toBe('hunter2');
    });

    test('legacy plaintext passwords are migrated and scrubbed on load', async () => {
        const api = makeBackend();
        api.__store['workspace-tabs'] = [mqttTab('t1', 'legacy')];
        const repo = new WorkspaceTabRepository(api, new SecretStore(api));

        const tabs = await repo.getTabs();
        await repo._writeChain;

        expect(tabs[0].request.password).toBe('legacy');
        expect(api.__store['workspace-tabs'][0].request.password).toBe('');
        expect(api.__chain.get('tab:t1|mqttPassword')).toBe('legacy');
    });

    test('closing the tab removes its secret', async () => {
        const api = makeBackend();
        const repo = new WorkspaceTabRepository(api, new SecretStore(api));
        await repo.saveTabs([mqttTab('t1', 'pw'), mqttTab('t2', '')]);

        await repo.deleteTab('t1');

        expect(api.__chain.has('tab:t1|mqttPassword')).toBe(false);
    });
});

describe('collection MQTT data keeps the password in the keychain', () => {
    test('save strips it from the sidecar and reads merge it back', async () => {
        const api = makeBackend();
        const repo = new CollectionRepository(api, new SecretStore(api));

        await repo.saveMqttData('c1', 'e1', { clientId: 'x', password: 'pw' });

        expect(api.__endpointData['c1/e1'].mqttData).toEqual({ clientId: 'x' });
        expect(await repo.getMqttData('c1', 'e1')).toEqual({ clientId: 'x', password: 'pw' });
        expect((await repo.getAllPersistedEndpointData('c1', 'e1')).mqttData.password).toBe('pw');
    });

    test('an empty password clears the secret; deleting endpoint data removes it', async () => {
        const api = makeBackend();
        const repo = new CollectionRepository(api, new SecretStore(api));
        await repo.saveMqttData('c1', 'e1', { password: 'pw' });

        await repo.saveMqttData('c1', 'e1', { password: '' });
        expect(api.__chain.has('mqtt:c1:e1|password')).toBe(false);

        await repo.saveMqttData('c1', 'e1', { password: 'pw2' });
        api.collections.deleteEndpointData = jest.fn().mockResolvedValue(undefined);
        await repo.deletePersistedEndpointData('c1', 'e1');
        expect(api.__chain.has('mqtt:c1:e1|password')).toBe(false);
    });
});
