/* global document */
import { collectionFeature } from '../../src/modules/collection.feature.js';
import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

function makeContext() {
    const shared = new Map();
    return {
        backendAPI: { collections: {}, store: { get: jest.fn().mockResolvedValue(null), set: jest.fn() } },
        statusDisplay: { update: jest.fn() },
        secretStore: { marker: 'secret-store' },
        toast: {},
        _shared: shared,
        provide(name, value) {
            shared.set(name, value);
            return value;
        },
        get(name) {
            return shared.get(name);
        }
    };
}

describe('collection feature', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="collections-list"></div><input id="collections-search-input">';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('builds the whole stack from the context without touching the DOM beyond its containers', () => {
        const ctx = makeContext();

        const instances = collectionFeature.create(ctx);

        expect(instances.controller).toBeInstanceOf(CollectionController);
        expect(instances.controller.service).toBe(instances.service);
        expect(instances.controller.repository).toBe(instances.repository);
        expect(instances.controller.renderer).toBe(instances.renderer);
        expect(instances.controller.requestPersistenceService).toBe(instances.requestPersistenceService);
        expect(instances.controller.importExportService).toBe(instances.importExportService);
        expect(instances.controller.collectionsSearchInput).toBe(document.getElementById('collections-search-input'));
    });

    test('hands the context secret store to the repository so secrets never hit disk in plaintext', () => {
        const ctx = makeContext();

        const { repository } = collectionFeature.create(ctx);

        expect(repository.secretStore).toBe(ctx.secretStore);
    });

    test('exposes the controller and service on app and the repository on the bus', () => {
        expect(collectionFeature.globals).toEqual({ collectionController: 'controller', collectionService: 'service' });
        expect(collectionFeature.provides).toEqual({ collectionRepository: 'repository', collectionController: 'controller' });
    });
});
