import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

describe('CollectionController.refreshGitStatus', () => {
    const makeFake = (repositoryResult) => ({
        gitStatus: { stale: true },
        gitStatusInFlight: false,
        repository: { gitStatus: jest.fn(repositoryResult) },
        renderer: { updateGitStatus: jest.fn() }
    });

    test('stores the status map and hands it to the renderer', async () => {
        const status = { c1: { changes: 2, requests: { r1: 'modified' } } };
        const fake = makeFake(() => Promise.resolve(status));

        await CollectionController.prototype.refreshGitStatus.call(fake);

        expect(fake.gitStatus).toBe(status);
        expect(fake.renderer.updateGitStatus).toHaveBeenCalledWith(status);
        expect(fake.gitStatusInFlight).toBe(false);
    });

    test('a failed call keeps the previous status and releases the guard', async () => {
        const fake = makeFake(() => Promise.reject(new Error('ipc')));

        await CollectionController.prototype.refreshGitStatus.call(fake);

        expect(fake.gitStatus).toEqual({ stale: true });
        expect(fake.renderer.updateGitStatus).not.toHaveBeenCalled();
        expect(fake.gitStatusInFlight).toBe(false);
    });

    test('a refresh already in flight is not re-entered', async () => {
        const fake = makeFake(() => Promise.resolve({}));
        fake.gitStatusInFlight = true;

        await CollectionController.prototype.refreshGitStatus.call(fake);

        expect(fake.repository.gitStatus).not.toHaveBeenCalled();
        expect(fake.gitStatusInFlight).toBe(true);
    });
});
