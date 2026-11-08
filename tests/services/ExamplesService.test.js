/* global document */
import { ExamplesService, EXAMPLES_CHANGED_EVENT } from '../../src/modules/services/ExamplesService.js';

function setup() {
    const stored = [{ id: 'a', name: 'A', status: 200 }, { id: 'b', name: 'B', status: 404 }];
    const repository = {
        getExamples: jest.fn().mockResolvedValue(stored),
        updateExamples: jest.fn(async (_c, _e, mutate) => mutate(stored.map((x) => ({ ...x }))))
    };
    const target = document.createElement('div');
    const events = [];
    target.addEventListener(EXAMPLES_CHANGED_EVENT, (event) => events.push(event.detail));
    return { service: new ExamplesService(repository, { eventTarget: target }), repository, events };
}

describe('ExamplesService', () => {
    test('getExamples delegates to the repository', async () => {
        const { service, repository } = setup();
        expect(await service.getExamples('c', 'e')).toHaveLength(2);
        expect(repository.getExamples).toHaveBeenCalledWith('c', 'e');
    });

    test('add, rename and delete mutate through the repository and broadcast the new list', async () => {
        const { service, events } = setup();

        const added = await service.addExample('c', 'e', { id: 'n', name: 'N', status: 201 });
        const renamed = await service.renameExample('c', 'e', 'a', 'Renamed');
        const deleted = await service.deleteExample('c', 'e', 'b');

        expect(added.map((x) => x.id)).toEqual(['a', 'b', 'n']);
        expect(renamed.find((x) => x.id === 'a').name).toBe('Renamed');
        expect(deleted.map((x) => x.id)).toEqual(['a']);
        expect(events.map((d) => [d.collectionId, d.endpointId, d.examples.length])).toEqual([['c', 'e', 3], ['c', 'e', 2], ['c', 'e', 1]]);
    });

    test('a failed write emits nothing', async () => {
        const { service, repository, events } = setup();
        repository.updateExamples.mockRejectedValueOnce(new Error('boom'));

        await expect(service.deleteExample('c', 'e', 'a')).rejects.toThrow('boom');
        expect(events).toEqual([]);
    });

    test('works without an event target', async () => {
        const { repository } = setup();
        const service = new ExamplesService(repository, { eventTarget: null });
        await expect(service.addExample('c', 'e', { id: 'x', name: 'X', status: 200 })).resolves.toHaveLength(3);
    });
});
