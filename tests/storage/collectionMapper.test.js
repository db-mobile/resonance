import { fromWire, toWire, listFromWire } from '../../src/modules/storage/collectionMapper.js';

/**
 * Characterization of the collection storage format.
 *
 * The two fixtures below ARE the format documentation: `wireFixture` is exactly
 * what the backend stores and returns, `domainFixture` is exactly what the rest
 * of the renderer sees. Any change to either shape should show up here as a
 * deliberate edit, not as a surprise elsewhere.
 */
const wireFixture = () => ({
    id: 'collection_1',
    name: 'Petstore',
    baseUrl: 'https://api.petstore.io/v1',
    defaultHeaders: { Accept: 'application/json' },
    authConfig: { type: 'bearer', config: { token: '' } },
    _openApiSpec: null,
    storagePath: '/home/user/.local/share/resonance/collections/petstore',
    endpoints: [
        { id: 'custom_1', name: 'Health', method: 'GET', path: '/health', protocol: 'http' },
        { id: 'custom_2', name: 'List Pets', method: 'GET', path: '/pets', protocol: 'http' }
    ],
    folders: [
        {
            id: 'folder_pets',
            name: 'pets',
            authConfig: { type: 'inherit', config: {} },
            endpoints: [
                { id: 'custom_2', name: 'List Pets', method: 'GET', path: '/pets', protocol: 'http' }
            ]
        }
    ]
});

const domainFixture = () => wireFixture();

describe('fromWire', () => {
    test('a full collection round-trips unchanged', () => {
        expect(fromWire(wireFixture())).toEqual(domainFixture());
    });

    test('guarantees the endpoints array', () => {
        expect(fromWire({ id: 'c1', name: 'Bare' }).endpoints).toEqual([]);
    });

    test('guarantees the folders array', () => {
        expect(fromWire({ id: 'c1', name: 'Bare' }).folders).toEqual([]);
    });

    test('guarantees each folder has an endpoints array', () => {
        const collection = fromWire({ id: 'c1', folders: [{ id: 'f1', name: 'pets' }] });
        expect(collection.folders[0].endpoints).toEqual([]);
    });

    test('preserves fields it does not know about', () => {
        const collection = fromWire({ id: 'c1', somethingNew: { nested: true } });
        expect(collection.somethingNew).toEqual({ nested: true });
    });

    test('does not mutate its input', () => {
        const wire = { id: 'c1', name: 'Bare' };
        fromWire(wire);
        expect(wire.endpoints).toBeUndefined();
    });

    test('maps nothing to null', () => {
        expect(fromWire(null)).toBeNull();
        expect(fromWire(undefined)).toBeNull();
    });
});

describe('toWire', () => {
    test('a full collection round-trips unchanged', () => {
        expect(toWire(domainFixture())).toEqual(wireFixture());
    });

    test('strips the search-expand marker from the collection', () => {
        const wire = toWire({ ...domainFixture(), __searchExpand: true });
        expect(wire).not.toHaveProperty('__searchExpand');
    });

    test('strips the search-expand marker from folders', () => {
        const collection = domainFixture();
        collection.folders[0].__searchExpand = true;

        const wire = toWire(collection);
        expect(wire.folders[0]).not.toHaveProperty('__searchExpand');
    });

    test('keeps folder fields other than the marker', () => {
        const collection = domainFixture();
        collection.folders[0].__searchExpand = true;

        const wire = toWire(collection);
        expect(wire.folders[0].authConfig).toEqual({ type: 'inherit', config: {} });
        expect(wire.folders[0].endpoints).toHaveLength(1);
    });

    test('does not mutate its input', () => {
        const collection = { ...domainFixture(), __searchExpand: true };
        toWire(collection);
        expect(collection.__searchExpand).toBe(true);
    });

    test('preserves fields it does not know about', () => {
        expect(toWire({ id: 'c1', somethingNew: 42 }).somethingNew).toBe(42);
    });

    test('tolerates a collection with no folders array', () => {
        expect(toWire({ id: 'c1' })).toEqual({ id: 'c1' });
    });

    test('maps nothing to null', () => {
        expect(toWire(null)).toBeNull();
    });
});

describe('round trip', () => {
    test('toWire(fromWire(x)) equals x for a full collection', () => {
        expect(toWire(fromWire(wireFixture()))).toEqual(wireFixture());
    });

    test('endpoint order is preserved verbatim', () => {
        const wire = toWire(fromWire(wireFixture()));
        expect(wire.endpoints.map(endpoint => endpoint.id)).toEqual(['custom_1', 'custom_2']);
    });

    test('a request duplicated into a folder survives both copies', () => {
        const wire = toWire(fromWire(wireFixture()));
        expect(wire.endpoints.some(endpoint => endpoint.id === 'custom_2')).toBe(true);
        expect(wire.folders[0].endpoints[0].id).toBe('custom_2');
    });
});

describe('the nested items shape', () => {
    const treeFixture = () => ({
        id: 'collection_1',
        name: 'Petstore',
        items: [
            { type: 'request', id: 'r1', name: 'Health' },
            {
                type: 'folder',
                id: 'f1',
                name: 'pets',
                items: [
                    { type: 'request', id: 'r2', name: 'List Pets' },
                    { type: 'folder', id: 'f2', name: 'admin', items: [] }
                ]
            }
        ]
    });

    test('fromWire passes a tree through without grafting legacy arrays onto it', () => {
        const collection = fromWire(treeFixture());

        expect(collection).toEqual(treeFixture());
        expect(collection).not.toHaveProperty('endpoints');
        expect(collection).not.toHaveProperty('folders');
    });

    test('toWire strips the search-expand marker from a nested folder', () => {
        const collection = treeFixture();
        collection.items[1].items[1].__searchExpand = true;

        const wire = toWire(collection);
        expect(wire.items[1].items[1]).not.toHaveProperty('__searchExpand');
    });

    test('toWire leaves request nodes untouched', () => {
        const wire = toWire(treeFixture());
        expect(wire.items[0]).toEqual({ type: 'request', id: 'r1', name: 'Health' });
    });

    test('round-trips unchanged', () => {
        expect(toWire(fromWire(treeFixture()))).toEqual(treeFixture());
    });
});

describe('the linked flag', () => {
    test('survives a round trip so the menu can swap Delete for Close', () => {
        const wire = { id: 'c1', name: 'Cloned', linked: true };

        expect(fromWire(wire).linked).toBe(true);
        expect(toWire(fromWire(wire)).linked).toBe(true);
    });

    test('is absent for an ordinary collection', () => {
        expect(fromWire({ id: 'c1', name: 'X' }).linked).toBeUndefined();
    });
});

describe('listFromWire', () => {
    test('normalizes every collection in the list', () => {
        const collections = listFromWire([{ id: 'c1' }, { id: 'c2' }]);
        expect(collections.map(collection => collection.endpoints)).toEqual([[], []]);
    });

    test('maps a missing list to an empty array', () => {
        expect(listFromWire(null)).toEqual([]);
        expect(listFromWire(undefined)).toEqual([]);
    });

    test('drops empty entries', () => {
        expect(listFromWire([{ id: 'c1' }, null])).toHaveLength(1);
    });
});
