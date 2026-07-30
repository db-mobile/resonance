import { CollectionService } from '../../src/modules/services/CollectionService.js';

/**
 * Endpoint ids are the join key for state that lives outside the collection
 * file: keychain auth scopes, pinned requests, scripts, mock-server overrides,
 * runner steps and workspace tabs are all keyed `${collectionId}_${endpointId}`.
 *
 * The old generator counted up from `custom_1` over the flat endpoints array,
 * which reused a deleted request's id and gave the replacement that request's
 * credentials and pins. Being a pure function of collection contents, it also
 * minted identical ids on two branches, so a merge produced two request files
 * claiming one id.
 */
describe('CollectionService.generateEndpointId', () => {
    let service;

    beforeEach(() => {
        service = new CollectionService({}, {}, { update: jest.fn() });
    });

    test('does not reuse the id of a deleted request', () => {
        const before = { id: 'c1', endpoints: [{ id: 'req_a' }, { id: 'req_b' }], folders: [] };
        const issued = service.generateEndpointId(before);

        const afterDelete = { id: 'c1', endpoints: [{ id: 'req_a' }], folders: [] };
        const reissued = service.generateEndpointId(afterDelete);

        expect(reissued).not.toBe(issued);
    });

    test('counts foldered requests when checking for collisions', () => {
        const collection = {
            id: 'c1',
            endpoints: [],
            folders: [{ id: 'f1', endpoints: [{ id: 'req_folder' }] }]
        };

        expect(service.generateEndpointId(collection)).not.toBe('req_folder');
    });

    test('counts requests in a nested items tree', () => {
        const collection = {
            id: 'c1',
            items: [
                {
                    type: 'folder',
                    id: 'f1',
                    items: [{ type: 'request', id: 'req_nested' }]
                }
            ]
        };

        expect(service.generateEndpointId(collection)).not.toBe('req_nested');
    });

    test('successive ids within one collection are distinct', () => {
        const collection = { id: 'c1', endpoints: [], folders: [] };

        const ids = new Set();
        for (let index = 0; index < 50; index += 1) {
            const id = service.generateEndpointId(collection);
            ids.add(id);
            collection.endpoints.push({ id });
        }

        expect(ids.size).toBe(50);
    });

    test('two collections with identical contents do not mint the same id', () => {
        const branchA = { id: 'c1', endpoints: [{ id: 'req_shared' }], folders: [] };
        const branchB = { id: 'c1', endpoints: [{ id: 'req_shared' }], folders: [] };

        expect(service.generateEndpointId(branchA)).not.toBe(service.generateEndpointId(branchB));
    });

    test('is not derived from the request count', () => {
        const collection = { id: 'c1', endpoints: [], folders: [] };

        expect(service.generateEndpointId(collection)).not.toBe('custom_1');
    });

    test('tolerates a collection with no requests at all', () => {
        expect(typeof service.generateEndpointId({ id: 'c1' })).toBe('string');
    });
});
