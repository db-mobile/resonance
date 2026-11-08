import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

function makeRepository() {
    const backendAPI = {
        collections: {
            getExamples: jest.fn().mockResolvedValue([{ id: 'ex1', name: 'A', status: 200 }]),
            saveExamples: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockResolvedValue([])
        },
        store: { get: jest.fn().mockResolvedValue(null), set: jest.fn() }
    };
    const repository = new CollectionRepository(backendAPI, null);
    return { repository, backendAPI };
}

describe('CollectionRepository examples', () => {
    test('getExamples normalises a missing list to an empty array and wraps failures', async () => {
        const { repository, backendAPI } = makeRepository();
        backendAPI.collections.getExamples.mockResolvedValueOnce(null);
        expect(await repository.getExamples('c1', 'e1')).toEqual([]);
        expect(backendAPI.collections.getExamples).toHaveBeenCalledWith('c1', 'e1');

        backendAPI.collections.getExamples.mockRejectedValueOnce(new Error('disk'));
        await expect(repository.getExamples('c1', 'e1')).rejects.toThrow('Failed to load examples');
    });

    test('saveExamples writes through the backend and invalidates the by-id cache', async () => {
        const { repository, backendAPI } = makeRepository();
        const invalidate = jest.spyOn(repository, 'invalidateCache');

        await repository.saveExamples('c1', 'e1', [{ id: 'ex2', name: 'B', status: 404 }]);

        expect(backendAPI.collections.saveExamples).toHaveBeenCalledWith('c1', 'e1', [{ id: 'ex2', name: 'B', status: 404 }]);
        expect(invalidate).toHaveBeenCalled();
        backendAPI.collections.saveExamples.mockRejectedValueOnce(new Error('ro'));
        await expect(repository.saveExamples('c1', 'e1', [])).rejects.toThrow('Failed to save examples');
    });

    test('updateExamples reads, mutates a copy and saves the result', async () => {
        const { repository, backendAPI } = makeRepository();

        const next = await repository.updateExamples('c1', 'e1', (list) => [...list, { id: 'ex2', name: 'B', status: 201 }]);

        expect(next.map((e) => e.id)).toEqual(['ex1', 'ex2']);
        expect(backendAPI.collections.saveExamples).toHaveBeenCalledWith('c1', 'e1', next);
    });

    test('writes to the same endpoint are serialised', async () => {
        const { repository, backendAPI } = makeRepository();
        const order = [];
        backendAPI.collections.saveExamples.mockImplementation(async (_c, _e, examples) => {
            order.push(`start:${examples.length}`);
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push(`end:${examples.length}`);
        });

        await Promise.all([
            repository.saveExamples('c1', 'e1', [{ id: 'a', name: 'A', status: 200 }]),
            repository.updateExamples('c1', 'e1', () => [])
        ]);

        expect(order).toEqual(['start:1', 'end:1', 'start:0', 'end:0']);
    });

    test('saveOne strips examples from the write-back except for new requests', async () => {
        const { repository, backendAPI } = makeRepository();
        const collection = {
            id: 'c1', name: 'C',
            endpoints: [
                { id: 'old', name: 'Old', examples: [{ id: 'x', name: 'X', status: 200 }] },
                { id: 'new', name: 'New', examples: [{ id: 'y', name: 'Y', status: 200 }] }
            ],
            folders: [{ id: 'f', name: 'F', endpoints: [{ id: 'old', name: 'Old', examples: [{ id: 'x', name: 'X', status: 200 }] }] }]
        };

        await repository.saveOne(collection, { newRequestIds: ['new'] });

        const wire = backendAPI.collections.save.mock.calls[0][0];
        expect(wire.endpoints[0].examples).toBeUndefined();
        expect(wire.endpoints[1].examples).toHaveLength(1);
        expect(wire.folders[0].endpoints[0].examples).toBeUndefined();
        expect(collection.endpoints[0].examples).toHaveLength(1);
    });
});
