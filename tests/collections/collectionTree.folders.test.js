import {
    findFolder,
    folderChainForRequest,
    folderOutline,
    insertFolder,
    insertRequest,
    moveRequest,
    rootRequests
} from '../../src/modules/collections/collectionTree.js';

const nested = () => ({
    id: 'c1',
    endpoints: [
        { id: 'root1', name: 'Root' },
        { id: 'a1', name: 'In A' },
        { id: 'b1', name: 'In B' }
    ],
    folders: [
        {
            id: 'fA',
            name: 'A',
            endpoints: [{ id: 'a1', name: 'In A' }],
            folders: [{ id: 'fB', name: 'B', endpoints: [{ id: 'b1', name: 'In B' }] }]
        }
    ]
});

describe('folder editing helpers', () => {
    test('insertFolder adds a top-level folder and a nested subfolder', () => {
        let c = insertFolder(nested(), null, { id: 'fTop', name: 'Top' });
        c = insertFolder(c, 'fB', { id: 'fDeep', name: 'Deep' });

        expect(findFolder(c, 'fTop')).toMatchObject({ name: 'Top', endpoints: [] });
        expect(findFolder(c, 'fDeep')).toMatchObject({ name: 'Deep' });
        expect(folderOutline(c).map(f => `${f.depth}:${f.name}`)).toEqual(['0:A', '1:B', '2:Deep', '0:Top']);
    });

    test('insertFolder rejects an unknown parent', () => {
        expect(() => insertFolder(nested(), 'nope', { id: 'x', name: 'X' })).toThrow('not found');
    });

    test('insertRequest reaches a nested folder', () => {
        const c = insertRequest(nested(), 'fB', { id: 'n1', name: 'New' });

        expect(folderChainForRequest(c, 'n1').map(f => f.id)).toEqual(['fA', 'fB']);
    });

    test('moveRequest moves between nested folders and to the root', () => {
        let c = moveRequest(nested(), 'b1', 'fA');
        expect(folderChainForRequest(c, 'b1').map(f => f.id)).toEqual(['fA']);
        expect(findFolder(c, 'fB').endpoints).toEqual([]);

        c = moveRequest(c, 'a1', null);
        expect(rootRequests(c).map(r => r.id)).toEqual(['root1', 'a1']);
        expect(c.endpoints.filter(e => e.id === 'a1')).toHaveLength(1);
    });

    test('moveRequest works on the items-tree shape', () => {
        const items = {
            id: 'c2',
            items: [
                { type: 'request', id: 'r1', name: 'R1' },
                { type: 'folder', id: 'f1', name: 'F', items: [] }
            ]
        };

        const moved = moveRequest(items, 'r1', 'f1');

        expect(moved.items).toHaveLength(1);
        expect(moved.items[0].items.map(i => i.id)).toEqual(['r1']);
    });

    test('moveRequest returns null for an unknown request', () => {
        expect(moveRequest(nested(), 'ghost', null)).toBeNull();
    });
});
