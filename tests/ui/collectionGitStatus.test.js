/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';
import { endpointKey } from '../../src/modules/collections/collectionTree.js';

const COLLECTIONS = [
    {
        id: 'c1',
        name: 'Payments',
        gitBranch: 'main',
        endpoints: [
            { id: 'r1', name: 'Charge', method: 'POST', path: '/charge' },
            { id: 'r2', name: 'Refund', method: 'POST', path: '/refund' }
        ],
        folders: [
            {
                id: 'f1',
                name: 'Webhooks',
                endpoints: [{ id: 'r4', name: 'Register', method: 'PUT', path: '/webhooks' }],
                folders: [{ id: 'f2', name: 'Legacy', endpoints: [{ id: 'r6', name: 'Old hook', method: 'PUT', path: '/v1/webhooks' }] }]
            }
        ]
    },
    {
        id: 'c2',
        name: 'Scratch',
        endpoints: [{ id: 'r3', name: 'Ping', method: 'GET', path: '/ping' }],
        folders: [{ id: 'f1', name: 'Also webhooks', endpoints: [{ id: 'r5', name: 'Hook', method: 'POST', path: '/hook' }] }]
    }
];

const PINNED = { [endpointKey('c1', 'r1')]: true };

describe('collection git change markers', () => {
    let renderer;

    const dotOf = id => document.querySelector(`.collection-item[data-collection-id="${id}"] .collection-git-dirty`);
    const dotsOf = id => document.querySelectorAll(`.collection-item[data-collection-id="${id}"] .collection-git-dirty`);
    const rowsOf = id => document.querySelectorAll(`.endpoint-item[data-endpoint-id="${id}"]`);
    const markerOf = id => document.querySelector(`.endpoint-item[data-endpoint-id="${id}"] .endpoint-git-marker`);
    const folderDotOf = (collectionId, folderId) => document.querySelector(
        `.collection-item[data-collection-id="${collectionId}"] .folder-item[data-folder-id="${folderId}"] > .folder-header > .folder-git-dirty`
    );

    beforeEach(async () => {
        document.body.innerHTML = '<div id="collections-list"></div>';
        renderer = new CollectionRenderer('collections-list');
        await renderer.renderCollections(COLLECTIONS, {}, false, {}, PINNED);
    });

    describe('collection dirty dot', () => {
        test('adds a dot with the change count to a collection that has a badge', () => {
            renderer.updateGitStatus({ c1: { changes: 3, requests: {} } });

            expect(dotOf('c1')).not.toBeNull();
            expect(dotOf('c1').title).toBe('3 uncommitted changes');
            expect(dotOf('c1').closest('.collection-git-badge')).not.toBeNull();
        });

        test('uses the singular for one change', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: {} } });

            expect(dotOf('c1').title).toBe('1 uncommitted change');
        });

        test('updates the title in place and keeps a single dot', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: {} } });
            renderer.updateGitStatus({ c1: { changes: 4, requests: {} } });

            expect(dotsOf('c1')).toHaveLength(1);
            expect(dotOf('c1').title).toBe('4 uncommitted changes');
        });

        test('removes the dot when the collection is clean again', () => {
            renderer.updateGitStatus({ c1: { changes: 2, requests: {} } });
            renderer.updateGitStatus({});

            expect(dotOf('c1')).toBeNull();
        });

        test('shows no dot on a collection without a branch badge', () => {
            renderer.updateGitStatus({ c2: { changes: 2, requests: {} } });

            expect(dotOf('c2')).toBeNull();
        });
    });

    describe('folder dots', () => {
        test('adds a dot with the change count to a folder header', () => {
            renderer.updateGitStatus({ c1: { changes: 2, requests: {}, folders: { f1: 2 } } });

            expect(folderDotOf('c1', 'f1')).not.toBeNull();
            expect(folderDotOf('c1', 'f1').title).toBe('2 uncommitted changes');
            expect(folderDotOf('c1', 'f1').previousElementSibling.classList.contains('folder-name')).toBe(true);
        });

        test('dots nested folders independently', () => {
            renderer.updateGitStatus({ c1: { changes: 2, requests: {}, folders: { f1: 2, f2: 1 } } });

            expect(folderDotOf('c1', 'f1').title).toBe('2 uncommitted changes');
            expect(folderDotOf('c1', 'f2').title).toBe('1 uncommitted change');
            expect(document.querySelectorAll('.folder-git-dirty')).toHaveLength(2);
        });

        test('removes the dot when the folder is clean again', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: {}, folders: { f1: 1 } } });
            renderer.updateGitStatus({ c1: { changes: 1, requests: {}, folders: {} } });

            expect(folderDotOf('c1', 'f1')).toBeNull();
        });

        test('leaves a folder with the same id in another collection alone', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: {}, folders: { f1: 1 } } });

            expect(folderDotOf('c1', 'f1')).not.toBeNull();
            expect(folderDotOf('c2', 'f1')).toBeNull();
        });

        test('can be re-applied after a full re-render', async () => {
            const status = { c1: { changes: 1, requests: {}, folders: { f2: 1 } } };
            renderer.updateGitStatus(status);
            await renderer.renderCollections(COLLECTIONS, {}, false, {}, PINNED);

            expect(folderDotOf('c1', 'f2')).toBeNull();

            renderer.updateGitStatus(status);

            expect(folderDotOf('c1', 'f2').title).toBe('1 uncommitted change');
        });
    });

    describe('request markers', () => {
        test('marks a modified request after its name', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r2: 'modified' } } });

            const marker = markerOf('r2');
            expect(marker.dataset.kind).toBe('modified');
            expect(marker.title).toBe('Modified, not committed');
            expect(marker.previousElementSibling.classList.contains('endpoint-path')).toBe(true);
            expect(rowsOf('r2')[0].classList.contains('git-modified')).toBe(true);
        });

        test('marks an added request', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r2: 'added' } } });

            expect(markerOf('r2').dataset.kind).toBe('added');
            expect(markerOf('r2').title).toBe('New, not committed');
            expect(rowsOf('r2')[0].classList.contains('git-added')).toBe(true);
        });

        test('marks both the pinned copy and the tree copy of a request', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r1: 'modified' } } });

            const rows = rowsOf('r1');
            expect(rows).toHaveLength(2);
            rows.forEach(row => expect(row.querySelector('.endpoint-git-marker')).not.toBeNull());
        });

        test('clears the marker and classes when the request becomes clean', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r2: 'modified' } } });
            renderer.updateGitStatus({});

            expect(markerOf('r2')).toBeNull();
            expect(rowsOf('r2')[0].classList.contains('git-modified')).toBe(false);
        });

        test('switches a marker from modified to added without duplicating it', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r2: 'modified' } } });
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r2: 'added' } } });

            expect(rowsOf('r2')[0].querySelectorAll('.endpoint-git-marker')).toHaveLength(1);
            expect(markerOf('r2').dataset.kind).toBe('added');
            expect(rowsOf('r2')[0].classList.contains('git-modified')).toBe(false);
            expect(rowsOf('r2')[0].classList.contains('git-added')).toBe(true);
        });

        test('leaves requests of other collections alone', () => {
            renderer.updateGitStatus({ c1: { changes: 1, requests: { r3: 'modified' } } });

            expect(markerOf('r3')).toBeNull();
        });

        test('can be re-applied after a full re-render', async () => {
            const status = { c1: { changes: 2, requests: { r2: 'modified' } } };
            renderer.updateGitStatus(status);
            await renderer.renderCollections(COLLECTIONS, {}, false, {}, PINNED);

            expect(markerOf('r2')).toBeNull();

            renderer.updateGitStatus(status);

            expect(markerOf('r2').dataset.kind).toBe('modified');
            expect(dotOf('c1').title).toBe('2 uncommitted changes');
        });
    });
});
