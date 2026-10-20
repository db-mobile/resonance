import {
    flattenRequests,
    requestsInFolder,
    rootRequests,
    topLevelFolders,
    findRequest,
    findFolder,
    folderChainForRequest,
    updateRequest,
    removeRequest,
    insertRequest
} from '../../src/modules/collections/collectionTree.js';

const flatCollection = () => ({
    id: 'c1',
    name: 'Flat',
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

const nestedCollection = () => ({
    id: 'c1',
    name: 'Nested',
    endpoints: [
        { id: 'r1', name: 'Health' },
        { id: 'r2', name: 'List Pets' },
        { id: 'r3', name: 'Create Pet' }
    ],
    folders: [
        {
            id: 'f1',
            name: 'pets',
            endpoints: [{ id: 'r2', name: 'List Pets' }],
            folders: [
                {
                    id: 'f2',
                    name: 'admin',
                    endpoints: [{ id: 'r3', name: 'Create Pet' }]
                }
            ]
        }
    ]
});

describe('flattenRequests', () => {
    test('yields each request exactly once despite duplication', () => {
        const ids = flattenRequests(flatCollection()).map(request => request.id);
        expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    test('root-level requests are included alongside foldered ones', () => {
        const ids = flattenRequests(flatCollection()).map(request => request.id);
        expect(ids).toContain('r1');
    });

    test('a collection with only folders yields the foldered requests', () => {
        const collection = { endpoints: [], folders: [{ id: 'f1', endpoints: [{ id: 'r9' }] }] };
        expect(flattenRequests(collection).map(request => request.id)).toEqual(['r9']);
    });

    test('a collection with only a flat list yields it unchanged', () => {
        const collection = { endpoints: [{ id: 'r1' }, { id: 'r2' }] };
        expect(flattenRequests(collection).map(request => request.id)).toEqual(['r1', 'r2']);
    });

    test('duplicate ids inside the flat list are collapsed', () => {
        const collection = { endpoints: [{ id: 'r1' }, { id: 'r1' }] };
        expect(flattenRequests(collection)).toHaveLength(1);
    });

    test('walks depth-first through nested folders', () => {
        const ids = flattenRequests(nestedCollection()).map(request => request.id);
        expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    test('returns requests by reference, not copies', () => {
        const collection = flatCollection();
        expect(flattenRequests(collection)[0]).toBe(collection.endpoints[0]);
    });

    test('tolerates a null collection and missing arrays', () => {
        expect(flattenRequests(null)).toEqual([]);
        expect(flattenRequests(undefined)).toEqual([]);
        expect(flattenRequests({})).toEqual([]);
        expect(flattenRequests({ folders: [{ id: 'f1' }] })).toEqual([]);
    });
});

describe('requestsInFolder', () => {
    test('returns a folder\'s requests in display order', () => {
        expect(requestsInFolder(flatCollection(), 'f1').map(r => r.id)).toEqual(['r2', 'r3']);
    });

    test('includes the requests of nested folders', () => {
        expect(requestsInFolder(nestedCollection(), 'f1').map(r => r.id)).toEqual(['r2', 'r3']);
        expect(requestsInFolder(nestedCollection(), 'f2').map(r => r.id)).toEqual(['r3']);
    });

    test('returns nothing for an unknown folder', () => {
        expect(requestsInFolder(nestedCollection(), 'nope')).toEqual([]);
    });
});

describe('rootRequests', () => {
    test('returns only the requests no folder claims', () => {
        expect(rootRequests(flatCollection()).map(request => request.id)).toEqual(['r1']);
    });

    test('a folderless collection reports its whole flat list', () => {
        const collection = { endpoints: [{ id: 'r1' }, { id: 'r2' }], folders: [] };
        expect(rootRequests(collection).map(request => request.id)).toEqual(['r1', 'r2']);
    });

    test('requests claimed by a nested folder are not root requests', () => {
        expect(rootRequests(nestedCollection()).map(request => request.id)).toEqual(['r1']);
    });

    test('tolerates a null collection', () => {
        expect(rootRequests(null)).toEqual([]);
    });
});

describe('topLevelFolders', () => {
    test('returns the folders array', () => {
        expect(topLevelFolders(flatCollection()).map(folder => folder.id)).toEqual(['f1']);
    });

    test('returns only top-level folders, not nested ones', () => {
        expect(topLevelFolders(nestedCollection()).map(folder => folder.id)).toEqual(['f1']);
    });

    test('tolerates a null collection and a missing folders array', () => {
        expect(topLevelFolders(null)).toEqual([]);
        expect(topLevelFolders({})).toEqual([]);
    });
});

describe('findRequest', () => {
    test.each([
        ['flat', flatCollection],
        ['nested', nestedCollection]
    ])('%s: finds a root-level request', (_label, build) => {
        expect(findRequest(build(), 'r1').name).toBe('Health');
    });

    test.each([
        ['flat', flatCollection],
        ['nested', nestedCollection]
    ])('%s: finds a foldered request', (_label, build) => {
        expect(findRequest(build(), 'r2').name).toBe('List Pets');
    });

    test('finds a request two folders deep', () => {
        expect(findRequest(nestedCollection(), 'r3').name).toBe('Create Pet');
    });

    test('returns null when absent', () => {
        expect(findRequest(flatCollection(), 'nope')).toBeNull();
        expect(findRequest(null, 'r1')).toBeNull();
    });
});

describe('findFolder', () => {
    test('finds a top-level folder', () => {
        expect(findFolder(flatCollection(), 'f1').name).toBe('pets');
    });

    test('finds a nested folder', () => {
        expect(findFolder(nestedCollection(), 'f2').name).toBe('admin');
    });

    test('returns null when absent', () => {
        expect(findFolder(nestedCollection(), 'nope')).toBeNull();
        expect(findFolder({}, 'f1')).toBeNull();
    });
});

describe('folderChainForRequest', () => {
    test('a root-level request has an empty chain', () => {
        expect(folderChainForRequest(flatCollection(), 'r1')).toEqual([]);
    });

    test('a foldered request reports its one folder', () => {
        const chain = folderChainForRequest(flatCollection(), 'r2');
        expect(chain.map(folder => folder.id)).toEqual(['f1']);
    });

    test('reports the chain outermost first', () => {
        const chain = folderChainForRequest(nestedCollection(), 'r3');
        expect(chain.map(folder => folder.id)).toEqual(['f1', 'f2']);
    });

    test('returns an empty chain for an unknown request', () => {
        expect(folderChainForRequest(nestedCollection(), 'nope')).toEqual([]);
    });
});

describe('updateRequest', () => {
    test('patches both the flat copy and the folder copy', () => {
        const updated = updateRequest(flatCollection(), 'r2', { name: 'Renamed' });

        expect(updated.endpoints.find(request => request.id === 'r2').name).toBe('Renamed');
        expect(updated.folders[0].endpoints.find(request => request.id === 'r2').name).toBe('Renamed');
    });

    test('patches a request inside a nested folder', () => {
        const updated = updateRequest(nestedCollection(), 'r3', { name: 'Renamed' });
        expect(findRequest(updated, 'r3').name).toBe('Renamed');
        expect(findFolder(updated, 'f2').endpoints[0].name).toBe('Renamed');
    });

    test('does not mutate the input collection', () => {
        const collection = flatCollection();
        updateRequest(collection, 'r2', { name: 'Renamed' });
        expect(collection.endpoints.find(request => request.id === 'r2').name).toBe('List Pets');
    });

    test('leaves sibling requests untouched', () => {
        const updated = updateRequest(nestedCollection(), 'r2', { name: 'Renamed' });
        expect(findRequest(updated, 'r1').name).toBe('Health');
        expect(findRequest(updated, 'r3').name).toBe('Create Pet');
    });

    test('returns null for an unknown request', () => {
        expect(updateRequest(flatCollection(), 'nope', { name: 'x' })).toBeNull();
    });
});

describe('removeRequest', () => {
    test('removes both copies', () => {
        const updated = removeRequest(flatCollection(), 'r2');

        expect(updated.endpoints.map(request => request.id)).toEqual(['r1', 'r3']);
        expect(updated.folders[0].endpoints.map(request => request.id)).toEqual(['r3']);
    });

    test('leaves an emptied folder in place', () => {
        const collection = { endpoints: [{ id: 'r1' }], folders: [{ id: 'f1', endpoints: [{ id: 'r1' }] }] };
        const updated = removeRequest(collection, 'r1');

        expect(updated.folders).toHaveLength(1);
        expect(updated.folders[0].endpoints).toEqual([]);
    });

    test('removes a request from a nested folder', () => {
        const updated = removeRequest(nestedCollection(), 'r3');

        expect(flattenRequests(updated).map(request => request.id)).toEqual(['r1', 'r2']);
        expect(findFolder(updated, 'f2').endpoints).toEqual([]);
    });

    test('does not mutate the input collection', () => {
        const collection = flatCollection();
        removeRequest(collection, 'r2');
        expect(collection.endpoints).toHaveLength(3);
    });

    test('returns null for an unknown request', () => {
        expect(removeRequest(nestedCollection(), 'nope')).toBeNull();
    });
});

describe('insertRequest', () => {
    test('a root insert appends to the flat list only', () => {
        const updated = insertRequest(flatCollection(), null, { id: 'r4', name: 'New' });

        expect(updated.endpoints.map(request => request.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
        expect(updated.folders[0].endpoints.map(request => request.id)).toEqual(['r2', 'r3']);
    });

    test('a folder insert appends to both the flat list and the folder', () => {
        const updated = insertRequest(flatCollection(), 'f1', { id: 'r4', name: 'New' });

        expect(updated.endpoints.map(request => request.id)).toContain('r4');
        expect(updated.folders[0].endpoints.map(request => request.id)).toEqual(['r2', 'r3', 'r4']);
    });

    test('inserts into a nested folder', () => {
        const updated = insertRequest(nestedCollection(), 'f2', { id: 'r4', name: 'New' });
        expect(findFolder(updated, 'f2').endpoints.map(request => request.id)).toEqual(['r3', 'r4']);
        expect(findFolder(updated, 'f1').endpoints.map(request => request.id)).toEqual(['r2']);
    });

    test('does not mutate the input collection', () => {
        const collection = nestedCollection();
        insertRequest(collection, 'f2', { id: 'r4' });
        expect(flattenRequests(collection)).toHaveLength(3);
    });

    test('throws for an unknown folder', () => {
        expect(() => insertRequest(flatCollection(), 'nope', { id: 'r4' })).toThrow(/nope/);
    });
});
