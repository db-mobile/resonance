/* global document */
import { CollectionRequestPersistenceService } from '../../src/modules/services/CollectionRequestPersistenceService.js';

jest.mock('../../src/modules/appContext.js', () => ({
    app: {
        captureGrpcState: () => ({ fullMethod: 'pkg.Svc/Method' })
    }
}));

/**
 * Sidecar-only saves used to reload every collection and rebuild the sidebar on
 * each send. Only path-changing saves may refresh the tree.
 */
describe('protocol savers skip the sidebar refresh', () => {
    let service;
    let refreshCollections;
    let repository;

    beforeEach(() => {
        document.body.innerHTML = '';
        refreshCollections = jest.fn().mockResolvedValue(undefined);
        repository = {
            savePersistedUrl: jest.fn().mockResolvedValue(undefined),
            savePersistedQueryParams: jest.fn().mockResolvedValue(undefined),
            savePersistedHeaders: jest.fn().mockResolvedValue(undefined),
            savePersistedAuthConfig: jest.fn().mockResolvedValue(undefined),
            saveGraphQLData: jest.fn().mockResolvedValue(undefined),
            saveMqttData: jest.fn().mockResolvedValue(undefined),
            saveGrpcData: jest.fn().mockResolvedValue(undefined),
            saveOne: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionRequestPersistenceService({
            repository,
            collectionService: { saveRequestBodyModification: jest.fn().mockResolvedValue(undefined) },
            statusDisplay: { update: jest.fn() },
            refreshCollections
        });
    });

    test('the WebSocket saver never refreshes the tree', async () => {
        await service.saveWebSocketRequest('c1', 'e1', () => ({}), () => []);

        expect(refreshCollections).not.toHaveBeenCalled();
    });

    test('the GraphQL saver never refreshes the tree', async () => {
        await service.saveGraphQLRequest('c1', 'e1', () => ({}), { getAuthConfig: () => null }, () => []);

        expect(refreshCollections).not.toHaveBeenCalled();
    });

    test('the SSE saver never refreshes the tree', async () => {
        await service.saveSseRequest('c1', 'e1', () => ({}), { getAuthConfig: () => null }, () => []);

        expect(refreshCollections).not.toHaveBeenCalled();
    });

    test('the MQTT saver never refreshes the tree', async () => {
        await service.saveMqttRequest('c1', 'e1');

        expect(refreshCollections).not.toHaveBeenCalled();
    });

    test('the gRPC saver refreshes only when the path changed', async () => {
        const collection = { id: 'c1', endpoints: [{ id: 'e1', path: 'pkg.Svc/Method' }], folders: [] };

        await service.saveGrpcRequest('c1', 'e1', { id: 'e1', path: 'pkg.Svc/Method' }, collection);
        expect(refreshCollections).not.toHaveBeenCalled();
        expect(repository.saveOne).not.toHaveBeenCalled();

        await service.saveGrpcRequest('c1', 'e1', { id: 'e1', path: 'pkg.Svc/Old' }, collection);
        expect(refreshCollections).toHaveBeenCalledTimes(1);
        expect(repository.saveOne).toHaveBeenCalledTimes(1);
    });
});
