import { CollectionService } from '../../src/modules/services/CollectionService.js';

describe('CollectionService.setRequestTags', () => {
    const fresh = () => ({
        id: 'c1',
        endpoints: [{ id: 'e1', name: 'List', tags: ['old'] }, { id: 'e2', name: 'Other' }],
        folders: [{ id: 'f1', endpoints: [{ id: 'e1', name: 'List', tags: ['old'] }], folders: [] }]
    });
    let service;

    beforeEach(() => {
        service = new CollectionService({ saveOne: jest.fn(async () => {}) }, {}, { update: jest.fn() });
        service._requireFresh = jest.fn(async () => fresh());
    });

    test('normalizes the tags, patches every copy of the request and saves the collection', async () => {
        const endpoint = await service.setRequestTags('c1', 'e1', [' Smoke ', 'smoke', 'pets']);

        expect(endpoint.tags).toEqual(['Smoke', 'pets']);
        const saved = service.repository.saveOne.mock.calls[0][0];
        expect(saved.endpoints[0].tags).toEqual(['Smoke', 'pets']);
        expect(saved.folders[0].endpoints[0].tags).toEqual(['Smoke', 'pets']);
        expect(saved.endpoints[1]).not.toHaveProperty('tags');
    });

    test('an empty list is saved as an explicit clear', async () => {
        await service.setRequestTags('c1', 'e1', []);

        expect(service.repository.saveOne.mock.calls[0][0].endpoints[0].tags).toEqual([]);
    });

    test('an unknown request is reported through the status display', async () => {
        await expect(service.setRequestTags('c1', 'missing', ['x'])).rejects.toThrow('missing');
        expect(service.statusDisplay.update).toHaveBeenCalledWith(expect.stringContaining('Error updating request tags'), null);
        expect(service.repository.saveOne).not.toHaveBeenCalled();
    });
});
