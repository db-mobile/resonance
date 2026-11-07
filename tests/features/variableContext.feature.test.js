import { variableContextFeature } from '../../src/modules/variableContext.feature.js';
import { VariableContext } from '../../src/modules/variables/VariableContext.js';
import { setCurrentEndpoint } from '../../src/modules/state/currentEndpoint.js';

function makeContext() {
    const shared = new Map();
    const environmentService = {
        addChangeListener: jest.fn(),
        getActiveEnvironment: jest.fn().mockResolvedValue({ id: 'env1', name: 'Dev', secretKeys: [] }),
        getActiveEnvironmentVariables: jest.fn().mockResolvedValue({ a: '1' })
    };
    const variableService = {
        addChangeListener: jest.fn(),
        getCollectionVariableEntries: jest.fn().mockResolvedValue([{ name: 'b', value: '2', secret: false }])
    };
    shared.set('environmentService', environmentService);
    shared.set('collectionVariableService', variableService);
    return {
        ctx: {
            _shared: shared,
            provide(name, value) { shared.set(name, value); return value; },
            get(name) { return shared.get(name); }
        },
        environmentService,
        variableService
    };
}

describe('variableContext feature', () => {
    afterEach(() => {
        setCurrentEndpoint(null);
    });

    test('builds the context from the shared services and exposes it', () => {
        const { ctx } = makeContext();

        const instances = variableContextFeature.create(ctx);

        expect(instances.context).toBeInstanceOf(VariableContext);
        expect(variableContextFeature.globals).toEqual({ variableContext: 'context' });
        expect(variableContextFeature.provides).toEqual({ variableContext: 'context' });
    });

    test('refreshes on environment, collection-variable and endpoint changes', async () => {
        const { ctx, environmentService, variableService } = makeContext();
        const { context } = variableContextFeature.create(ctx);
        const refresh = jest.spyOn(context, 'refresh').mockResolvedValue(undefined);

        environmentService.addChangeListener.mock.calls[0][0]({ type: 'environment-switched' });
        variableService.addChangeListener.mock.calls[0][0]({ type: 'collection-variables-changed' });
        setCurrentEndpoint({ collectionId: 'c', endpointId: 'e' });

        expect(refresh).toHaveBeenCalledTimes(3);
    });

    test('init performs the first refresh', async () => {
        const { ctx } = makeContext();
        const instances = variableContextFeature.create(ctx);

        await variableContextFeature.init(instances, ctx);

        expect(instances.context.ready).toBe(true);
        expect(instances.context.lookup('a').status).toBe('resolved');
    });
});
