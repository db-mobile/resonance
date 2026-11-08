/* global document */
import { VariableContext, VARIABLES_CHANGED_EVENT } from '../../src/modules/variables/VariableContext.js';
import { DYNAMIC_VARIABLES } from '../../src/modules/variables/dynamicVariables.js';
import { deferred } from '../helpers/coreExecution.js';

function setup({ endpoint = { collectionId: 'c1', endpointId: 'e1' }, eventTarget = null } = {}) {
    const environmentService = {
        getActiveEnvironment: jest.fn().mockResolvedValue({ id: 'env1', name: 'Dev', secretKeys: ['token'] }),
        getActiveEnvironmentVariables: jest.fn().mockResolvedValue({ baseUrl: 'https://dev', token: 'hunter2', shared: 'env' })
    };
    const variableService = {
        getCollectionVariableEntries: jest.fn().mockResolvedValue([
            { name: 'apiVersion', value: 'v2', secret: false },
            { name: 'shared', value: 'collection', secret: false },
            { name: 'apiKey', value: 'k', secret: true }
        ])
    };
    const context = new VariableContext({
        environmentService,
        variableService,
        getCurrentEndpoint: () => endpoint,
        eventTarget
    });
    return { context, environmentService, variableService };
}

describe('VariableContext', () => {
    test('reports unknown before the first refresh and dynamic names immediately', () => {
        const { context } = setup();

        expect(context.ready).toBe(false);
        expect(context.lookup('baseUrl').status).toBe('unknown');
        expect(context.lookup('$uuid')).toMatchObject({ status: 'dynamic', scope: 'dynamic', name: '$uuid', example: '{{$uuid}}' });
        expect(context.lookup('$nope').status).toBe('unresolved');
    });

    test('resolves environment over collection and keeps scope, env name and secret flag', async () => {
        const { context, variableService } = setup();

        await context.refresh();

        expect(context.ready).toBe(true);
        expect(variableService.getCollectionVariableEntries).toHaveBeenCalledWith('c1');
        expect(context.lookup('baseUrl')).toEqual({
            status: 'resolved', name: 'baseUrl', scope: 'environment', value: 'https://dev', secret: false, envName: 'Dev'
        });
        expect(context.lookup('shared')).toMatchObject({ scope: 'environment', value: 'env' });
        expect(context.lookup('apiVersion')).toEqual({
            status: 'resolved', name: 'apiVersion', scope: 'collection', value: 'v2', secret: false, envName: null
        });
        expect(context.lookup('missing')).toEqual({
            status: 'unresolved', name: 'missing', scope: null, value: null, secret: false, envName: null
        });
    });

    test('never exposes secret values', async () => {
        const { context } = setup();

        await context.refresh();

        expect(context.lookup('token')).toMatchObject({ status: 'resolved', scope: 'environment', secret: true, value: null });
        expect(context.lookup('apiKey')).toMatchObject({ status: 'resolved', scope: 'collection', secret: true, value: null });
        expect(JSON.stringify(context.list())).not.toContain('hunter2');
    });

    test('lists environment, then collection with shadowing, then the dynamic catalogue', async () => {
        const { context } = setup();

        await context.refresh();
        const entries = context.list();

        expect(entries.slice(0, 3).map((e) => [e.name, e.scope])).toEqual([
            ['baseUrl', 'environment'], ['shared', 'environment'], ['token', 'environment']
        ]);
        expect(entries.slice(3, 6).map((e) => [e.name, e.scope, e.shadowed])).toEqual([
            ['apiKey', 'collection', false], ['apiVersion', 'collection', false], ['shared', 'collection', true]
        ]);
        expect(entries.slice(6).map((e) => e.name)).toEqual(DYNAMIC_VARIABLES.map((d) => `$${d.name}`));
    });

    test('skips collection lookup without an endpoint', async () => {
        const { context, variableService } = setup({ endpoint: null });

        await context.refresh();

        expect(variableService.getCollectionVariableEntries).not.toHaveBeenCalled();
        expect(context.lookup('apiVersion').status).toBe('unresolved');
        expect(context.lookup('baseUrl').status).toBe('resolved');
    });

    test('tolerates failing services', async () => {
        const { context, environmentService, variableService } = setup();
        environmentService.getActiveEnvironment.mockRejectedValue(new Error('x'));
        environmentService.getActiveEnvironmentVariables.mockRejectedValue(new Error('x'));
        variableService.getCollectionVariableEntries.mockRejectedValue(new Error('x'));

        await context.refresh();

        expect(context.ready).toBe(true);
        expect(context.lookup('baseUrl').status).toBe('unresolved');
    });

    test('drops stale refreshes and bumps the version once per applied refresh', async () => {
        const { context, environmentService } = setup();
        const first = deferred();
        const second = deferred();
        environmentService.getActiveEnvironmentVariables
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const versions = [];
        context.addChangeListener((event) => versions.push(event.version));

        const firstRefresh = context.refresh();
        const secondRefresh = context.refresh();
        second.resolve({ baseUrl: 'second' });
        await secondRefresh;
        first.resolve({ baseUrl: 'first' });
        await firstRefresh;

        expect(context.lookup('baseUrl').value).toBe('second');
        expect(context.version).toBe(1);
        expect(versions).toEqual([1]);
    });

    test('dispatches a DOM event on the given target after each refresh', async () => {
        const target = document.createElement('div');
        const detail = [];
        target.addEventListener(VARIABLES_CHANGED_EVENT, (event) => detail.push(event.detail));
        const { context } = setup({ eventTarget: target });

        await context.refresh();
        await context.refresh();

        expect(detail).toEqual([{ version: 1 }, { version: 2 }]);
    });

    test('removeChangeListener stops notifications', async () => {
        const { context } = setup();
        const listener = jest.fn();
        context.addChangeListener(listener);
        context.removeChangeListener(listener);

        await context.refresh();

        expect(listener).not.toHaveBeenCalled();
    });
});
