import {
    flattenRequests,
    rootRequests,
    topLevelFolders,
    findRequest,
    findFolder,
    folderChainForRequest,
    updateRequest,
    removeRequest,
    insertRequest
} from '../../src/modules/collections/collectionTree.js';

const legacyCollection = () => ({
    id: 'c1',
    name: 'Legacy',
    endpoints: [
        { id: 'r1', name: 'Health' },
        { id: 'r2', name: 'List Pets' },
        { id: 'r3', name: 'Create Pet' }
    ],
    folders: [
        {
            id: 'f1',
            name: 'pets',
            endpoints: [
                { id: 'r2', name: 'List Pets' },
                { id: 'r3', name: 'Create Pet' }
            ]
        }
    ]
});

const itemsCollection = () => ({
    id: 'c1',
    name: 'Tree',
    items: [
        { type: 'request', id: 'r1', name: 'Health' },
        {
            type: 'folder',
            id: 'f1',
            name: 'pets',
            items: [
                { type: 'request', id: 'r2', name: 'List Pets' },
                {
                    type: 'folder',
                    id: 'f2',
                    name: 'admin',
                    items: [{ type: 'request', id: 'r3', name: 'Create Pet' }]
                }
            ]
        }
    ]
});

describe('flattenRequests', () => {
    test('legacy: yields each request exactly once despite duplication', () => {
        const ids = flattenRequests(legacyCollection()).map(request => request.id);
        expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    test('legacy: root-level requests are included alongside foldered ones', () => {
        const ids = flattenRequests(legacyCollection()).map(request => request.id);
        expect(ids).toContain('r1');
    });

    test('legacy: a collection with only folders yields the foldered requests', () => {
        const collection = { endpoints: [], folders: [{ id: 'f1', endpoints: [{ id: 'r9' }] }] };
        expect(flattenRequests(collection).map(request => request.id)).toEqual(['r9']);
    });

    test('legacy: a collection with only a flat list yields it unchanged', () => {
        const collection = { endpoints: [{ id: 'r1' }, { id: 'r2' }] };
        expect(flattenRequests(collection).map(request => request.id)).toEqual(['r1', 'r2']);
    });

    test('legacy: duplicate ids inside the flat list are collapsed', () => {
        const collection = { endpoints: [{ id: 'r1' }, { id: 'r1' }] };
        expect(flattenRequests(collection)).toHaveLength(1);
    });

    test('items: walks depth-first through nested folders', () => {
        const ids = flattenRequests(itemsCollection()).map(request => request.id);
        expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    test('returns requests by reference, not copies', () => {
        const collection = legacyCollection();
        expect(flattenRequests(collection)[0]).toBe(collection.endpoints[0]);
    });

    test('tolerates a null collection and missing arrays', () => {
        expect(flattenRequests(null)).toEqual([]);
        expect(flattenRequests(undefined)).toEqual([]);
        expect(flattenRequests({})).toEqual([]);
        expect(flattenRequests({ folders: [{ id: 'f1' }] })).toEqual([]);
    });
});

describe('rootRequests', () => {
    test('legacy: returns only the requests no folder claims', () => {
        expect(rootRequests(legacyCollection()).map(request => request.id)).toEqual(['r1']);
    });

    test('legacy: a folderless collection reports its whole flat list', () => {
        const collection = { endpoints: [{ id: 'r1' }, { id: 'r2' }], folders: [] };
        expect(rootRequests(collection).map(request => request.id)).toEqual(['r1', 'r2']);
    });

    test('items: returns only the top-level request nodes', () => {
        expect(rootRequests(itemsCollection()).map(request => request.id)).toEqual(['r1']);
    });

    test('tolerates a null collection', () => {
        expect(rootRequests(null)).toEqual([]);
    });
});

describe('topLevelFolders', () => {
    test('legacy: returns the folders array', () => {
        expect(topLevelFolders(legacyCollection()).map(folder => folder.id)).toEqual(['f1']);
    });

    test('items: returns only top-level folders, not nested ones', () => {
        expect(topLevelFolders(itemsCollection()).map(folder => folder.id)).toEqual(['f1']);
    });

    test('tolerates a null collection and a missing folders array', () => {
        expect(topLevelFolders(null)).toEqual([]);
        expect(topLevelFolders({})).toEqual([]);
    });
});

describe('findRequest', () => {
    test.each([
        ['legacy', legacyCollection],
        ['items', itemsCollection]
    ])('%s: finds a root-level request', (_label, build) => {
        expect(findRequest(build(), 'r1').name).toBe('Health');
    });

    test.each([
        ['legacy', legacyCollection],
        ['items', itemsCollection]
    ])('%s: finds a foldered request', (_label, build) => {
        expect(findRequest(build(), 'r2').name).toBe('List Pets');
    });

    test('items: finds a request three levels deep', () => {
        expect(findRequest(itemsCollection(), 'r3').name).toBe('Create Pet');
    });

    test('returns null when absent', () => {
        expect(findRequest(legacyCollection(), 'nope')).toBeNull();
        expect(findRequest(null, 'r1')).toBeNull();
    });
});

describe('findFolder', () => {
    test('legacy: finds a top-level folder', () => {
        expect(findFolder(legacyCollection(), 'f1').name).toBe('pets');
    });

    test('items: finds a nested folder', () => {
        expect(findFolder(itemsCollection(), 'f2').name).toBe('admin');
    });

    test('returns null when absent', () => {
        expect(findFolder(itemsCollection(), 'nope')).toBeNull();
        expect(findFolder({}, 'f1')).toBeNull();
    });
});

describe('folderChainForRequest', () => {
    test('legacy: a root-level request has an empty chain', () => {
        expect(folderChainForRequest(legacyCollection(), 'r1')).toEqual([]);
    });

    test('legacy: a foldered request reports its one folder', () => {
        const chain = folderChainForRequest(legacyCollection(), 'r2');
        expect(chain.map(folder => folder.id)).toEqual(['f1']);
    });

    test('items: reports the chain outermost first', () => {
        const chain = folderChainForRequest(itemsCollection(), 'r3');
        expect(chain.map(folder => folder.id)).toEqual(['f1', 'f2']);
    });

    test('returns an empty chain for an unknown request', () => {
        expect(folderChainForRequest(itemsCollection(), 'nope')).toEqual([]);
    });
});

describe('updateRequest', () => {
    test('legacy: patches both the flat copy and the folder copy', () => {
        const updated = updateRequest(legacyCollection(), 'r2', { name: 'Renamed' });

        expect(updated.endpoints.find(request => request.id === 'r2').name).toBe('Renamed');
        expect(updated.folders[0].endpoints.find(request => request.id === 'r2').name).toBe('Renamed');
    });

    test('items: patches the single node', () => {
        const updated = updateRequest(itemsCollection(), 'r3', { name: 'Renamed' });
        expect(findRequest(updated, 'r3').name).toBe('Renamed');
    });

    test('does not mutate the input collection', () => {
        const collection = legacyCollection();
        updateRequest(collection, 'r2', { name: 'Renamed' });
        expect(collection.endpoints.find(request => request.id === 'r2').name).toBe('List Pets');
    });

    test('leaves sibling requests untouched', () => {
        const updated = updateRequest(itemsCollection(), 'r2', { name: 'Renamed' });
        expect(findRequest(updated, 'r1').name).toBe('Health');
        expect(findRequest(updated, 'r3').name).toBe('Create Pet');
    });

    test('returns null for an unknown request', () => {
        expect(updateRequest(legacyCollection(), 'nope', { name: 'x' })).toBeNull();
    });
});

describe('removeRequest', () => {
    test('legacy: removes both copies', () => {
        const updated = removeRequest(legacyCollection(), 'r2');

        expect(updated.endpoints.map(request => request.id)).toEqual(['r1', 'r3']);
        expect(updated.folders[0].endpoints.map(request => request.id)).toEqual(['r3']);
    });

    test('legacy: leaves an emptied folder in place', () => {
        const collection = { endpoints: [{ id: 'r1' }], folders: [{ id: 'f1', endpoints: [{ id: 'r1' }] }] };
        const updated = removeRequest(collection, 'r1');

        expect(updated.folders).toHaveLength(1);
        expect(updated.folders[0].endpoints).toEqual([]);
    });

    test('items: removes a nested request', () => {
        const updated = removeRequest(itemsCollection(), 'r3');

        expect(flattenRequests(updated).map(request => request.id)).toEqual(['r1', 'r2']);
        expect(findFolder(updated, 'f2').items).toEqual([]);
    });

    test('does not mutate the input collection', () => {
        const collection = legacyCollection();
        removeRequest(collection, 'r2');
        expect(collection.endpoints).toHaveLength(3);
    });

    test('returns null for an unknown request', () => {
        expect(removeRequest(itemsCollection(), 'nope')).toBeNull();
    });
});

describe('insertRequest', () => {
    test('legacy: a root insert appends to the flat list only', () => {
        const updated = insertRequest(legacyCollection(), null, { id: 'r4', name: 'New' });

        expect(updated.endpoints.map(request => request.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
        expect(updated.folders[0].endpoints.map(request => request.id)).toEqual(['r2', 'r3']);
    });

    test('legacy: a folder insert appends to both the flat list and the folder', () => {
        const updated = insertRequest(legacyCollection(), 'f1', { id: 'r4', name: 'New' });

        expect(updated.endpoints.map(request => request.id)).toContain('r4');
        expect(updated.folders[0].endpoints.map(request => request.id)).toEqual(['r2', 'r3', 'r4']);
    });

    test('items: a root insert tags the node as a request', () => {
        const updated = insertRequest(itemsCollection(), null, { id: 'r4', name: 'New' });
        expect(updated.items.at(-1)).toEqual({ type: 'request', id: 'r4', name: 'New' });
    });

    test('items: inserts into a nested folder', () => {
        const updated = insertRequest(itemsCollection(), 'f2', { id: 'r4', name: 'New' });
        expect(findFolder(updated, 'f2').items.map(item => item.id)).toEqual(['r3', 'r4']);
    });

    test('does not mutate the input collection', () => {
        const collection = itemsCollection();
        insertRequest(collection, 'f2', { id: 'r4' });
        expect(flattenRequests(collection)).toHaveLength(3);
    });

    test('throws for an unknown folder', () => {
        expect(() => insertRequest(legacyCollection(), 'nope', { id: 'r4' })).toThrow(/nope/);
    });
});
