import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

describe('CollectionController.refreshGitBranches', () => {
    const makeFake = (branches) => ({
        gitRefreshInFlight: false,
        allCollections: [{ id: 'c1', gitBranch: 'main' }, { id: 'c2', gitBranch: null }],
        repository: { gitBranches: jest.fn().mockResolvedValue(branches) },
        renderer: { updateGitBadges: jest.fn() },
        loadCollectionsWithExpansionState: jest.fn().mockResolvedValue([])
    });

    test('a branch switch reloads the collections instead of only repainting the badge', async () => {
        const fake = makeFake({ c1: 'feature' });

        await CollectionController.prototype.refreshGitBranches.call(fake);

        expect(fake.loadCollectionsWithExpansionState).toHaveBeenCalledTimes(1);
        expect(fake.renderer.updateGitBadges).not.toHaveBeenCalled();
    });

    test('an unchanged branch only repaints the badges', async () => {
        const fake = makeFake({ c1: 'main' });

        await CollectionController.prototype.refreshGitBranches.call(fake);

        expect(fake.loadCollectionsWithExpansionState).not.toHaveBeenCalled();
        expect(fake.renderer.updateGitBadges).toHaveBeenCalledWith({ c1: 'main' });
        expect(fake.gitRefreshInFlight).toBe(false);
    });
});
