import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

/**
 * Search used to be folders-else-flat, so a collection holding folders *and*
 * root-level requests could never surface the root ones, and nested folders
 * were not searched at all.
 */
describe('CollectionController.filterCollections', () => {
    let controller;

    const collection = () => ({
        id: 'c1',
        name: 'Petstore',
        endpoints: [
            { id: 'root1', name: 'Health Check', method: 'GET', path: '/health' },
            { id: 'outer1', name: 'List Pets', method: 'GET', path: '/pets' },
            { id: 'inner1', name: 'Create Admin', method: 'POST', path: '/admin' }
        ],
        folders: [
            {
                id: 'outer',
                name: 'pets',
                endpoints: [{ id: 'outer1', name: 'List Pets', method: 'GET', path: '/pets' }],
                folders: [
                    {
                        id: 'inner',
                        name: 'admin',
                        endpoints: [{ id: 'inner1', name: 'Create Admin', method: 'POST', path: '/admin' }]
                    }
                ]
            }
        ]
    });

    beforeEach(() => {
        controller = Object.create(CollectionController.prototype);
    });

    test('an empty query returns the collections untouched', () => {
        const input = [collection()];
        expect(controller.filterCollections(input, '')).toBe(input);
    });

    test('a root-level request is found even though the collection has folders', () => {
        const [result] = controller.filterCollections([collection()], 'health');

        expect(result.endpoints.map(e => e.id)).toEqual(['root1']);
        expect(result.__searchExpand).toBe(true);
    });

    test('a request inside a nested folder is found', () => {
        const [result] = controller.filterCollections([collection()], 'create admin');

        expect(result.folders).toHaveLength(1);
        expect(result.folders[0].folders[0].endpoints.map(e => e.id)).toEqual(['inner1']);
    });

    test('the whole chain to a nested match is marked for expansion', () => {
        const [result] = controller.filterCollections([collection()], 'create admin');

        expect(result.__searchExpand).toBe(true);
        expect(result.folders[0].__searchExpand).toBe(true);
        expect(result.folders[0].folders[0].__searchExpand).toBe(true);
    });

    test('a folder matched by name keeps all of its contents', () => {
        const [result] = controller.filterCollections([collection()], 'admin');
        const inner = result.folders[0].folders[0];

        expect(inner.endpoints).toHaveLength(1);
    });

    test('a non-matching branch is dropped', () => {
        const [result] = controller.filterCollections([collection()], 'health');

        expect(result.folders).toEqual([]);
    });

    test('a collection with nothing matching is dropped entirely', () => {
        expect(controller.filterCollections([collection()], 'zzzz')).toEqual([]);
    });

    test('a collection matched by its own name is kept', () => {
        const [result] = controller.filterCollections([collection()], 'petstore');

        expect(result.id).toBe('c1');
        expect(result.__searchExpand).toBe(false);
    });

    test('the input collections are not mutated', () => {
        const input = collection();
        controller.filterCollections([input], 'health');

        expect(input.endpoints).toHaveLength(3);
        expect(input.folders[0].folders).toHaveLength(1);
        expect(input).not.toHaveProperty('__searchExpand');
    });
});
