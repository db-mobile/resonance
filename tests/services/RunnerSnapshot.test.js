import { CoreExecutionService } from '../../src/modules/services/CoreExecutionService.js';
import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';
import { VariableRepository } from '../../src/modules/storage/VariableRepository.js';
import { ScriptController } from '../../src/modules/controllers/ScriptController.js';
import { InlineScriptManager } from '../../src/modules/ui/InlineScriptManager.js';
import { app } from '../../src/modules/appContext.js';

function setup(count = 100) {
    const raw = [{ collectionId: 'c', collection: { id: 'c', baseUrl: 'https://example.test', defaultHeaders: {} },
        variables: [{ key: 'token', value: '', secret: true }],
        targets: Array.from({ length: count }, (_, index) => ({ endpointId: `e${index}`,
            endpoint: { id: `e${index}`, method: 'GET', path: `/${index}`, tags: ['smoke'] },
            persisted: { authConfig: { type: 'bearer', config: { token: '' } } },
            inheritedAuth: [{ source: { kind: 'collection' }, authConfig: { type: 'basic', config: { username: 'u', password: '' } } }],
            scripts: { preRequestScript: '', testScript: 'saved()' }
        })) }];
    const backend = { collections: { captureExecutionSnapshot: jest.fn(async () => JSON.parse(JSON.stringify(raw))),
        get: jest.fn(), getEndpointData: jest.fn(), getVariables: jest.fn() },
    settings: { get: async () => ({}) }, scripts: { get: jest.fn() } };
    const secretStore = { getScope: jest.fn(async scope => scope === 'collvar:c' ? { token: 'variable-secret' }
        : scope.endsWith('__collection__') ? { password: 'parent-secret' } : { token: 'request-secret' }) };
    const pipeline = { backendAPI: backend, collectionRepository: new CollectionRepository(backend, secretStore),
        variableRepository: new VariableRepository(backend, secretStore),
        environmentRepository: { getActiveEnvironmentVariables: async () => ({}) },
        mockBaseUrlFor: jest.fn(async () => null) };
    const service = new CoreExecutionService(pipeline);
    const runner = { collectionId: 'c', requests: raw[0].targets.map(t => ({ collectionId: 'c', endpointId: t.endpointId, name: t.endpointId })), options: {} };
    return { raw, backend, secretStore, pipeline, service, runner };
}

afterEach(() => { delete app.scriptController; });

test('100 requests use one compact snapshot and hydrate secrets without individual reads', async () => {
    const { backend, secretStore, pipeline, service, runner } = setup();
    const result = await service.captureRun(runner);
    expect(result.requests).toHaveLength(100);
    expect(result.requests[0].auth.config.token).toBe('request-secret');
    expect(result.requests[0].inheritedAuth[0].authConfig.config.password).toBe('parent-secret');
    expect(result.context.collections.c.token).toBe('variable-secret');
    expect(backend.collections.captureExecutionSnapshot).toHaveBeenCalledTimes(1);
    expect(backend.collections.get).not.toHaveBeenCalled();
    expect(backend.collections.getEndpointData).not.toHaveBeenCalled();
    expect(backend.collections.getVariables).not.toHaveBeenCalled();
    expect(backend.scripts.get).not.toHaveBeenCalled();
    expect(secretStore.getScope.mock.calls.filter(([scope]) => scope.endsWith('__collection__'))).toHaveLength(1);
    expect(pipeline.mockBaseUrlFor).toHaveBeenCalledTimes(1);
});

test('duplicate queue entries keep independent overrides and each run reads fresh values', async () => {
    const { raw, backend, service, runner } = setup(1);
    runner.requests.push({ ...runner.requests[0], name: 'second', overrides: { body: 'override' } });
    const first = await service.captureRun(runner);
    expect(backend.collections.captureExecutionSnapshot.mock.calls[0][0]).toHaveLength(1);
    expect(first.requests[1].body.content).toBe('override');
    first.requests[0].auth.config.token = 'changed';
    expect(first.requests[1].auth.config.token).toBe('request-secret');
    raw[0].targets[0].endpoint.path = '/external-edit';
    expect((await service.captureRun(runner)).requests[0].path).toBe('/external-edit');
    expect(first.requests[0].path).toBe('/0');
});

test('captures current scripts before an awaited save changes the displayed request', async () => {
    const { service, runner } = setup(1);
    const manager = { currentCollectionId: 'c', currentEndpointId: 'e0',
        getCurrentScripts: () => ({ preRequestScript: 'unsaved()', testScript: '' }),
        flushPendingSave: jest.fn(async () => { manager.currentEndpointId = 'other'; }) };
    app.scriptController = new ScriptController({}, manager, {});
    const result = await service.captureRun(runner);
    expect(result.requests[0].preRequestScript).toBe('unsaved()');
    expect(result.requests[0].testScript).toBe('');
    expect(manager.flushPendingSave).toHaveBeenCalledTimes(1);
});

test('snapshot failure rejects capture and empty queues avoid collection IPC', async () => {
    const { backend, service, runner } = setup(0);
    expect((await service.captureRun(runner)).requests).toEqual([]);
    expect(backend.collections.captureExecutionSnapshot).not.toHaveBeenCalled();
    runner.requests.push({ collectionId: 'c', endpointId: 'e' });
    backend.collections.captureExecutionSnapshot.mockRejectedValue(new Error('IPC failed'));
    await expect(service.captureRun(runner)).rejects.toThrow('IPC failed');
});

test('snapshot variables bypass a stale shared cache without modifying it', async () => {
    const { raw, pipeline, service, runner } = setup(1);
    pipeline.variableRepository._cache.set('c', { old: 'cached' });
    raw[0].variables.push({ key: 'fresh', value: 'disk' });
    const result = await service.captureRun(runner);
    expect(result.context.collections.c).toEqual({ token: 'variable-secret', fresh: 'disk' });
    expect(pipeline.variableRepository._cache.get('c')).toEqual({ old: 'cached' });
});

test('multiple collections and missing targets retain queue order and per-entry errors', async () => {
    const { raw, service, runner } = setup(1);
    raw.push({ collectionId: 'other', collection: { id: 'other', baseUrl: '', defaultHeaders: {} }, variables: [],
        targets: [{ ...raw[0].targets[0], endpointId: 'missing', endpoint: null }] });
    raw.push({ collectionId: 'gone', collection: null, variables: [],
        targets: [{ endpointId: 'e', endpoint: null, persisted: {}, inheritedAuth: [], scripts: {} }] });
    runner.requests.unshift({ collectionId: 'other', endpointId: 'missing', name: 'missing' });
    runner.requests.push({ collectionId: 'gone', endpointId: 'e', name: 'gone' });
    const result = await service.captureRun(runner);
    expect(result.requests.map(r => r.name)).toEqual(['missing', 'e0', 'gone']);
    expect(result.requests[0].captureError.code).toBe('missingRequest');
    expect(result.requests[2].captureError.code).toBe('missingCollection');
});

test('an autosave failure retains the active editor scripts without changing persisted scripts', async () => {
    const { raw, service, runner, backend } = setup(1);
    global.window.backendAPI = { scripts: { save: jest.fn(async () => { throw new Error('disk full'); }) } };
    const manager = new InlineScriptManager();
    manager.currentCollectionId = 'c'; manager.currentEndpointId = 'e0';
    manager.preRequestEditor = { getContent: () => 'unsaved()' };
    manager.testScriptEditor = { getContent: () => '' };
    manager.scheduleAutoSave();
    app.scriptController = new ScriptController({}, manager, {});
    try {
        const result = await service.captureRun(runner);
        expect(result.requests[0].preRequestScript).toBe('unsaved()');
        expect(raw[0].targets[0].scripts.testScript).toBe('saved()');
        expect(global.window.backendAPI.scripts.save).toHaveBeenCalledTimes(1);
        expect(backend.scripts.get).not.toHaveBeenCalled();
    } finally { delete global.window.backendAPI; }
});

test('environment failure and snapshot failure are both observed during startup', async () => {
    const { backend, pipeline, service, runner } = setup(1);
    pipeline.environmentRepository.getActiveEnvironment = async () => { throw new Error('environment failed'); };
    backend.collections.captureExecutionSnapshot.mockRejectedValue(new Error('snapshot failed'));
    await expect(service.captureRun(runner)).rejects.toThrow('snapshot failed');
});
