import { CoreExecutionService, captureRunnerEntry } from '../../src/modules/services/CoreExecutionService.js';
import { app } from '../../src/modules/appContext.js';
import { deferred } from '../helpers/coreExecution.js';

function setup() {
    const listeners = new Set();
    const unlisten = jest.fn(async () => listeners.clear());
    const backend = {
        execution: {
            listen: jest.fn(async (listener) => {
                listeners.add(listener);
                return unlisten;
            }),
            request: jest.fn(),
            run: jest.fn(),
            cancel: jest.fn(async () => ({ success: true }))
        }
    };
    const pipeline = {
        backendAPI: backend,
        environmentRepository: { applyVariableChanges: jest.fn() },
        variableRepository: { applyVariableChanges: jest.fn() },
        collectionRepository: {}
    };
    const service = new CoreExecutionService(pipeline);
    const execution = service.createExecution();
    const emit = (sequence, kind, data = {}, executionId = execution.executionId) => {
        for (const listener of listeners) {
            listener({ sequence, kind, data, executionId });
        }
    };
    return { service, backend, pipeline, execution, emit, unlisten };
}

afterEach(() => {
    delete app.cookieController;
});

test('registers before starting, orders deltas, and drains persistence before completion', async () => {
    const { service, backend, pipeline, execution, emit, unlisten } = setup();
    const write = deferred();
    pipeline.environmentRepository.applyVariableChanges.mockReturnValue(write.promise);
    const events = [];
    backend.execution.request.mockImplementation(async () => {
        emit(2, 'effect', { kind: 'script', collectionId: 'captured-collection', collection: { x: '2' } });
        emit(1, 'effect', { kind: 'script', environmentId: 'captured-environment', environment: { token: '1' } });
        emit(3, 'completed', { status: 'success' });
    });
    const work = service.execute('request', {}, execution, (event) => events.push(event.kind));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pipeline.environmentRepository.applyVariableChanges).toHaveBeenCalledWith('captured-environment', {
        token: '1'
    });
    expect(pipeline.variableRepository.applyVariableChanges).not.toHaveBeenCalled();
    expect(events).not.toContain('completed');
    write.resolve();
    expect((await work).status).toBe('success');
    expect(events).toEqual(['effect', 'effect', 'completed']);
    expect(pipeline.variableRepository.applyVariableChanges).toHaveBeenCalledWith('captured-collection', { x: '2' });
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(backend.execution.listen.mock.invocationCallOrder[0]).toBeLessThan(
        backend.execution.request.mock.invocationCallOrder[0]
    );
});

test('persistence errors are surfaced and cancel scheduling while listeners are released', async () => {
    const { service, backend, pipeline, execution, emit, unlisten } = setup();
    pipeline.environmentRepository.applyVariableChanges.mockRejectedValue(new Error('disk full'));
    backend.execution.run.mockImplementation(async () => {
        emit(1, 'effect', { kind: 'script', environmentId: 'env', environment: { x: '1' } });
        emit(2, 'completed', { requests: [], terminationReason: 'completed' });
    });
    const result = await service.execute('run', {}, execution);
    expect(result.terminationReason).toBe('persistenceError');
    expect(result.error).toContain('disk full');
    expect(execution.cancelled).toBe(false); // Persistence failure must still be presented.
    expect(backend.execution.cancel).toHaveBeenCalledWith(execution.executionId);
    expect(unlisten).toHaveBeenCalledTimes(1);
});

test('an IPC failure releases its listener and propagates the error', async () => {
    const { service, backend, execution, unlisten } = setup();
    backend.execution.request.mockRejectedValue(new Error('IPC failed'));
    await expect(service.execute('request', {}, execution)).rejects.toThrow('IPC failed');
    expect(unlisten).toHaveBeenCalledTimes(1);
});

test('settles from the invoke receipt when completion and an effect event are lost', async () => {
    const { service, backend, pipeline, execution, emit, unlisten } = setup();
    const write = deferred();
    pipeline.environmentRepository.applyVariableChanges.mockReturnValue(write.promise);
    const effect = { executionId: execution.executionId, sequence: 1, kind: 'effect',
        data: { kind: 'script', environmentId: 'env', environment: { token: 'new' } } };
    backend.execution.request.mockImplementation(async () => {
        emit(2, 'script', { phase: 'pre' });
        return { result: { status: 'success' }, sequence: 3, effects: [effect] };
    });
    const onEvent = jest.fn();
    const work = service.execute('request', {}, execution, onEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pipeline.environmentRepository.applyVariableChanges).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls.some(([event]) => event.kind === 'completed')).toBe(false);
    write.resolve();
    await expect(work).resolves.toMatchObject({ status: 'success' });
    expect(onEvent.mock.calls.filter(([event]) => event.kind === 'completed')).toHaveLength(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
});

test('receipt effect replay does not persist already delivered effects twice', async () => {
    const { service, backend, pipeline, execution, emit } = setup();
    const effect = { executionId: execution.executionId, sequence: 1, kind: 'effect',
        data: { kind: 'script', environmentId: 'env', environment: { token: 'new' } } };
    backend.execution.request.mockImplementation(async () => {
        emit(1, effect.kind, effect.data);
        emit(2, 'completed', { status: 'success' });
        return { result: { status: 'success' }, sequence: 2, effects: [effect] };
    });
    await service.execute('request', {}, execution);
    expect(pipeline.environmentRepository.applyVariableChanges).toHaveBeenCalledTimes(1);
});

test('compact runner progress and receipts restore report aliases without cloning response bodies', async () => {
    const { service, backend, execution, emit } = setup();
    const response = { status: 200, data: { large: 'x'.repeat(100_000) }, headers: { 'content-type': 'application/json' },
        isBinary: true, bodyBase64: 'AAEC' };
    const item = { index: 0, status: 'success', apiResponse: response };
    backend.execution.run.mockImplementation(async () => {
        emit(1, 'response', { response });
        emit(2, 'request-completed', { index: 0, result: { status: 'success' } });
        emit(3, 'completed', { passed: 1 });
        return { result: { passed: 1, requests: [item] }, sequence: 3, effects: [] };
    });
    const onEvent = jest.fn();
    const result = await service.execute('run', {}, execution, onEvent);
    const progress = onEvent.mock.calls.find(([event]) => event.kind === 'request-completed')[0].data.result;
    expect(progress.body).toBe(response.data);
    expect(result.requests[0].body).toBe(response.data);
    expect(result.requests[0].response.body).toBe(response.data);
    expect(result.requests[0].apiResponse.bodyBase64).toBe('AAEC');
});

test('ignores other execution IDs, duplicate deliveries, and stale presentation events', async () => {
    const { service, backend, execution, emit } = setup();
    const onEvent = jest.fn();
    backend.execution.request.mockImplementation(async () => {
        emit(1, 'script', {}, 'different');
        emit(1, 'script');
        emit(1, 'script');
        emit(2, 'completed', { status: 'success' });
    });
    await service.execute('request', {}, execution, onEvent, () => false);
    expect(onEvent).not.toHaveBeenCalled();
});

test('cancelling before startup never invokes an execution', async () => {
    const { service, backend, execution } = setup();
    await execution.cancel();
    expect((await service.execute('run', {}, execution)).terminationReason).toBe('stoppedByUser');
    expect(backend.execution.run).not.toHaveBeenCalled();
    expect(backend.execution.listen).not.toHaveBeenCalled();
});

test('cookie effects target the captured environment even after the user switches', async () => {
    const { service } = setup();
    app.cookieController = { applyScriptCookieChanges: jest.fn() };
    const changes = [{ op: 'clear' }];
    await service.applyEffect({ kind: 'cookies', environmentId: 'old-env', cookies: changes });
    expect(app.cookieController.applyScriptCookieChanges).toHaveBeenCalledWith(changes, 'old-env');
});

test('OAuth effects merge credential deltas with current auth and use secret-aware repositories', async () => {
    const { service, pipeline } = setup();
    pipeline.collectionRepository.getCollectionAuthConfig = jest.fn(async () => ({
        type: 'oauth2',
        config: { token: 'old', scope: 'edited', clientSecret: 'kept', expiresAt: 10 }
    }));
    pipeline.collectionRepository.saveAuthConfigAtSource = jest.fn();
    await service.applyEffect({
        kind: 'auth',
        collectionId: 'c',
        endpointId: 'e',
        source: { kind: 'collection' },
        changes: { token: 'new', expiresAt: null }
    });
    expect(pipeline.collectionRepository.saveAuthConfigAtSource).toHaveBeenCalledWith(
        'c',
        'e',
        { kind: 'collection' },
        { type: 'oauth2', config: { token: 'new', scope: 'edited', clientSecret: 'kept' } }
    );
});

const target = {
    collection: { id: 'c', baseUrl: 'https://api.test', defaultHeaders: { Accept: 'application/json' } },
    endpoint: { id: 'e', path: '/users/{id}', method: 'POST', parameters: { path: { id: { example: 7 } } } },
    persisted: {
        pathParams: [{ key: 'id', value: '{{id}}' }],
        headers: [{ key: 'X-Token', value: '{{token}}' }],
        queryParams: [
            { key: 'q', value: 'a' },
            { key: 'q', value: 'b' }
        ],
        modifiedBody: '{"id":"{{id}}"}'
    },
    inheritedAuth: [],
    scripts: { preRequestScript: 'pm.variables.set("id", 1)' },
    mockBaseUrl: null
};

test('captures raw templates, duplicate query rows, and independent duplicate queue overrides', () => {
    const a = captureRunnerEntry({ name: 'A', overrides: { body: '{"a":1}', headers: [] } }, target);
    const b = captureRunnerEntry({ name: 'B', overrides: { body: '{"b":2}', pathParams: [] } }, target);
    expect(a.body.content).toBe('{"a":1}');
    expect(b.body.content).toBe('{"b":2}');
    expect(a.headers).toEqual({});
    expect(b.headers).toEqual({ 'X-Token': '{{token}}' });
    expect(a.queryRows.map((r) => r.value)).toEqual(['a', 'b']);
    expect(b.pathParams).toEqual({ id: '{{id}}' });
    a.queryRows[0].value = 'changed';
    expect(b.queryRows[0].value).toBe('a');
});

test('cleared body overrides stay empty and missing targets remain per-entry errors', () => {
    expect(captureRunnerEntry({ overrides: { body: '' } }, target).body.content).toBe('');
    expect(captureRunnerEntry({ endpointId: 'missing' }, { ...target, endpoint: null }).captureError.code).toBe(
        'missingRequest'
    );
});

test('captures proxy settings from the desktop IPC namespace and pins an immutable environment snapshot', async () => {
    const { service, backend, pipeline } = setup();
    const variables = { token: 'startup' };
    const settings = { cookieJarEnabled: true };
    const proxy = { mode: 'manual', url: 'http://proxy.test:8080' };
    pipeline.environmentRepository.getActiveEnvironment = async () => ({ id: 'original', name: 'Original' });
    pipeline.environmentRepository.getVariablesForEnvironment = jest.fn(async () => variables);
    pipeline.variableRepository.getVariablesForCollection = async () => ({ shared: 'collection' });
    backend.settings = { get: async () => settings };
    backend.proxySettings = { get: jest.fn(async () => proxy) };
    const snapshot = await service.captureContext(['c', 'c']);
    variables.token = 'edited';
    settings.cookieJarEnabled = false;
    proxy.url = 'http://edited.test';
    expect(snapshot.environment).toEqual({ token: 'startup' });
    expect(snapshot.environmentId).toBe('original');
    expect(snapshot.proxy.url).toBe('http://proxy.test:8080');
    expect(snapshot.settings.cookieJarEnabled).toBe(true);
    expect(backend.proxySettings.get).toHaveBeenCalledTimes(1);
    expect(pipeline.environmentRepository.getVariablesForEnvironment).toHaveBeenCalledWith('original');
});
