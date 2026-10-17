import { ScriptService } from '../../src/modules/services/ScriptService.js';

const request = { url: 'https://api.test/items', method: 'GET' };
const successfulResult = (changes = {}) => ({
    success: true, logs: [], errors: [], testResults: [], ...changes
});

function createFixture() {
    const storedEnvironments = {
        'env-original': { token: 'old', environmentOnly: 'environment' },
        'env-new': { token: 'unrelated' }
    };
    let activeEnvironmentId = 'env-new';
    const storedCollections = {
        first: { shared: 'first collection', firstOnly: 'collection' },
        second: { shared: 'second collection' }
    };
    const cookieWrites = [];
    const environmentService = {
        getActiveEnvironmentVariables: jest.fn(async () => ({ ...storedEnvironments[activeEnvironmentId] })),
        getActiveEnvironment: jest.fn(async () => ({ id: activeEnvironmentId })),
        applyVariableChanges: jest.fn(async (id, changes) => {
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) {delete storedEnvironments[id][key];}
                else {storedEnvironments[id][key] = value;}
            }
        })
    };
    const variableRepository = {
        getVariablesForCollection: jest.fn(async id => ({ ...storedCollections[id] })),
        applyVariableChanges: jest.fn(async (id, changes) => {
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) {delete storedCollections[id][key];}
                else {storedCollections[id][key] = value;}
            }
        })
    };
    const backendAPI = {
        scripts: {
            executePreRequest: jest.fn().mockResolvedValue(successfulResult()),
            executeTest: jest.fn().mockResolvedValue(successfulResult())
        }
    };
    const service = new ScriptService(null, environmentService, null, variableRepository, {
        backendAPI,
        getSettings: () => ({ cookieJarEnabled: true }),
        cookieController: {
            getCookiesForScripts: async () => [],
            applyScriptCookieChanges: async changes => cookieWrites.push(...changes)
        }
    });
    const scope = {
        active: true,
        runner: true,
        environmentId: 'env-original',
        environment: { ...storedEnvironments['env-original'] },
        localVariables: {},
        collections: new Map()
    };
    return {
        service, scope, backendAPI, storedEnvironments, storedCollections, cookieWrites,
        selectEnvironment(id) { activeEnvironmentId = id; }
    };
}

describe('ScriptService execution scopes', () => {
    it('passes environment, collection, iteration, and local variables as separate scopes', async () => {
        const { service, scope, backendAPI } = createFixture();
        scope.localVariables = { shared: { source: 'local' }, localOnly: false };

        await service.executePreRequestScript('inspect scopes', request, {
            scope,
            collectionId: 'first',
            environment: { firstOnly: 'collection', localOnly: false, shared: 'flattened' },
            iteration: { data: { shared: 'iteration', count: 0 }, index: 0, count: 2 }
        });

        const payload = backendAPI.scripts.executePreRequest.mock.calls[0][0];
        expect(payload.environment).toEqual({ token: 'old', environmentOnly: 'environment' });
        expect(payload.collectionVariables).toEqual({ shared: 'first collection', firstOnly: 'collection' });
        expect(payload.localVariables).toEqual({ shared: { source: 'local' }, localOnly: false });
        expect(payload.iteration.data).toEqual({ shared: 'iteration', count: 0 });
    });

    it('shares typed local writes from pre-request through tests without persisting them', async () => {
        const { service, scope, backendAPI, storedEnvironments, storedCollections } = createFixture();
        scope.localVariables = { stale: 'remove me', keep: 'existing' };
        const typedValues = { token: { access: ['one', 'two'] }, count: 0, enabled: false, empty: null };
        backendAPI.scripts.executePreRequest.mockResolvedValue(successfulResult({
            modifiedLocalVariables: typedValues,
            removedLocalVariables: ['stale']
        }));

        await service.executePreRequestScript('write locals', request, { scope, collectionId: 'first' });
        await service.executeTestScript('read locals', request, { status: 200 }, { scope, collectionId: 'first' });

        expect(scope.localVariables).toEqual({ keep: 'existing', ...typedValues });
        expect(backendAPI.scripts.executeTest.mock.calls[0][0].localVariables).toEqual(scope.localVariables);
        expect(storedEnvironments['env-original'].token).toBe('old');
        expect(storedCollections.first).toEqual({ shared: 'first collection', firstOnly: 'collection' });
    });

    it('pins environment writes to the environment chosen at execution start', async () => {
        const { service, scope, backendAPI, storedEnvironments, selectEnvironment } = createFixture();
        selectEnvironment('env-new');
        backendAPI.scripts.executePreRequest.mockResolvedValue(successfulResult({
            modifiedEnvironment: { token: 'fresh', environmentOnly: null }
        }));

        await service.executePreRequestScript('update pinned environment', request, { scope });
        await service.executeTestScript('read updated environment', request, { status: 200 }, { scope });

        expect(storedEnvironments['env-original']).toEqual({ token: 'fresh' });
        expect(storedEnvironments['env-new']).toEqual({ token: 'unrelated' });
        expect(backendAPI.scripts.executeTest.mock.calls[0][0].environment).toEqual({ token: 'fresh' });
    });

    it('keeps collection changes isolated when requests cross collections', async () => {
        const { service, scope, backendAPI, storedCollections } = createFixture();
        backendAPI.scripts.executePreRequest.mockResolvedValue(successfulResult({
            modifiedCollectionVariables: { shared: 'updated first' }
        }));

        await service.executePreRequestScript('write first collection', request, { scope, collectionId: 'first' });
        await service.executeTestScript('read second collection', request, { status: 200 }, { scope, collectionId: 'second' });
        await service.executeTestScript('read first collection', request, { status: 200 }, { scope, collectionId: 'first' });

        expect(backendAPI.scripts.executeTest.mock.calls[0][0].collectionVariables).toEqual({ shared: 'second collection' });
        expect(backendAPI.scripts.executeTest.mock.calls[1][0].collectionVariables.shared).toBe('updated first');
        expect(storedCollections.second).toEqual({ shared: 'second collection' });
    });

    it.each(['pre-request', 'post-response'])(
        'discards late %s side effects after its execution is cancelled',
        async phase => {
            const { service, scope, backendAPI, storedEnvironments, storedCollections, cookieWrites } = createFixture();
            scope.localVariables = { preserved: true };
            let completeBackend;
            let notifyStarted;
            const started = new Promise(resolve => { notifyStarted = resolve; });
            const delayedResult = new Promise(resolve => { completeBackend = resolve; });
            const execute = phase === 'pre-request' ? backendAPI.scripts.executePreRequest : backendAPI.scripts.executeTest;
            execute.mockImplementation(() => {
                notifyStarted();
                return delayedResult;
            });

            const completion = phase === 'pre-request'
                ? service.executePreRequestScript('eventually writes', request, { scope, collectionId: 'first' })
                : service.executeTestScript('eventually writes', request, { status: 200 }, { scope, collectionId: 'first' });
            await started;
            scope.active = false;
            completeBackend(successfulResult({
                modifiedEnvironment: { token: 'too late' },
                modifiedCollectionVariables: { shared: 'too late' },
                modifiedLocalVariables: { token: 'too late' },
                removedLocalVariables: ['preserved'],
                cookieChanges: [{ op: 'clear' }]
            }));
            await completion;

            expect(storedEnvironments['env-original'].token).toBe('old');
            expect(storedEnvironments['env-new'].token).toBe('unrelated');
            expect(storedCollections.first.shared).toBe('first collection');
            expect(scope.localVariables).toEqual({ preserved: true });
            expect(cookieWrites).toEqual([]);
        }
    );
});
