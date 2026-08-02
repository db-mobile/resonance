/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

/**
 * A collection opened in place usually lives in a git checkout, so the sidebar
 * row shows the branch. The badge is patched in place on refresh rather than
 * re-rendered: a branch switched in a terminal must not collapse the tree.
 */
describe('collection git branch badge', () => {
    let renderer;

    const branchOf = header => header.querySelector('.collection-git-badge .collection-git-branch')?.textContent;

    beforeEach(() => {
        document.body.innerHTML = '<div id="collections-container"></div>';
        renderer = new CollectionRenderer('collections-container');
    });

    describe('createCollectionHeader', () => {
        test('shows the branch when the collection lives in a repository', () => {
            const header = renderer.createCollectionHeader({ id: 'c1', name: 'Payments', gitBranch: 'main' });

            expect(branchOf(header)).toBe('main');
            expect(header.querySelector('.collection-git-badge').title).toBe('main');
            expect(header.querySelector('.collection-git-badge .icon-branch')).not.toBeNull();
        });

        test('shows no badge when the collection is not under version control', () => {
            const header = renderer.createCollectionHeader({ id: 'c1', name: 'Scratch' });

            expect(header.querySelector('.collection-git-badge')).toBeNull();
        });

        test('keeps the collection name in its own element so the badge cannot bleed into it', () => {
            const header = renderer.createCollectionHeader({ id: 'c1', name: 'Payments', gitBranch: 'main' });

            expect(header.querySelector('.collection-name').textContent).toBe('Payments');
        });
    });

    describe('updateGitBadges', () => {
        const render = collections => {
            document.getElementById('collections-container').innerHTML = '';
            collections.forEach(collection => {
                const item = document.createElement('div');
                item.className = 'collection-item';
                item.dataset.collectionId = collection.id;
                item.appendChild(renderer.createCollectionHeader(collection));
                document.getElementById('collections-container').appendChild(item);
            });
        };

        const headerOf = id => document.querySelector(`.collection-item[data-collection-id="${id}"] .collection-header`);

        test('adds a badge to a collection that had none', () => {
            render([{ id: 'c1', name: 'Payments' }]);

            renderer.updateGitBadges({ c1: 'main' });

            expect(branchOf(headerOf('c1'))).toBe('main');
        });

        test('updates a badge after a checkout', () => {
            render([{ id: 'c1', name: 'Payments', gitBranch: 'main' }]);

            renderer.updateGitBadges({ c1: 'feature/oauth-refresh' });

            const header = headerOf('c1');
            expect(branchOf(header)).toBe('feature/oauth-refresh');
            expect(header.querySelector('.collection-git-badge').title).toBe('feature/oauth-refresh');
            expect(header.querySelectorAll('.collection-git-badge')).toHaveLength(1);
        });

        test('removes the badge when a collection is no longer in a repository', () => {
            render([{ id: 'c1', name: 'Payments', gitBranch: 'main' }]);

            renderer.updateGitBadges({});

            expect(headerOf('c1').querySelector('.collection-git-badge')).toBeNull();
        });

        test('leaves other collections alone', () => {
            render([
                { id: 'c1', name: 'Payments', gitBranch: 'main' },
                { id: 'c2', name: 'Internal', gitBranch: 'dev' }
            ]);

            renderer.updateGitBadges({ c1: 'release', c2: 'dev' });

            expect(branchOf(headerOf('c1'))).toBe('release');
            expect(branchOf(headerOf('c2'))).toBe('dev');
        });
    });
});
