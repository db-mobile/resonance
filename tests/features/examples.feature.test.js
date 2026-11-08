import { examplesFeature } from '../../src/modules/examples.feature.js';
import { ExamplesService } from '../../src/modules/services/ExamplesService.js';
import { ExamplesController } from '../../src/modules/controllers/ExamplesController.js';
import { setCurrentEndpoint } from '../../src/modules/state/currentEndpoint.js';

function makeContext() {
    const shared = new Map([['collectionRepository', { getExamples: jest.fn().mockResolvedValue([]), updateExamples: jest.fn() }]]);
    return { _shared: shared, provide: (n, v) => shared.set(n, v), get: (n) => shared.get(n) };
}

describe('examples feature', () => {
    afterEach(() => {
        setCurrentEndpoint(null);
    });

    test('builds the service and controller and exposes both', () => {
        const instances = examplesFeature.create(makeContext());

        expect(instances.service).toBeInstanceOf(ExamplesService);
        expect(instances.controller).toBeInstanceOf(ExamplesController);
        expect(examplesFeature.globals).toEqual({ examplesService: 'service', examplesController: 'controller' });
        expect(examplesFeature.provides).toEqual({ examplesService: 'service' });
    });

    test('init follows the current endpoint: loads when bound, clears otherwise', () => {
        const instances = examplesFeature.create(makeContext());
        const load = jest.spyOn(instances.controller, 'loadExamples').mockResolvedValue(undefined);
        const clear = jest.spyOn(instances.controller, 'clearContext').mockImplementation(() => {});
        setCurrentEndpoint({ collectionId: 'c', endpointId: 'e' });

        examplesFeature.init(instances, makeContext());
        setCurrentEndpoint(null);
        setCurrentEndpoint({ collectionId: 'c2', endpointId: 'e2' });

        expect(load.mock.calls).toEqual([['c', 'e'], ['c2', 'e2']]);
        expect(clear).toHaveBeenCalledTimes(1);
    });
});
