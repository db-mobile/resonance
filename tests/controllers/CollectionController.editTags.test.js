import { CollectionController } from '../../src/modules/controllers/CollectionController.js';

function makeController(result) {
    const controller = Object.create(CollectionController.prototype);
    controller.editTagsDialog = { show: jest.fn(async () => result) };
    controller.service = { setRequestTags: jest.fn(async () => ({})) };
    controller.loadCollectionsWithExpansionState = jest.fn(async () => {});
    return controller;
}

const collection = { id: 'c1' };

describe('CollectionController.handleEditTags', () => {
    test('opens the dialog with the normalized current tags and saves a changed list', async () => {
        const controller = makeController(['smoke', 'Pets']);
        await controller.handleEditTags(collection, { id: 'e1', tags: [' smoke ', 'SMOKE'] });

        expect(controller.editTagsDialog.show).toHaveBeenCalledWith(['smoke'], expect.objectContaining({ title: 'Edit Tags' }));
        expect(controller.service.setRequestTags).toHaveBeenCalledWith('c1', 'e1', ['smoke', 'Pets']);
        expect(controller.loadCollectionsWithExpansionState).toHaveBeenCalled();
    });

    test('does nothing on cancel or when the list is unchanged', async () => {
        const cancelled = makeController(null);
        await cancelled.handleEditTags(collection, { id: 'e1', tags: ['smoke'] });
        expect(cancelled.service.setRequestTags).not.toHaveBeenCalled();

        const unchanged = makeController(['smoke']);
        await unchanged.handleEditTags(collection, { id: 'e1', tags: ['smoke'] });
        expect(unchanged.service.setRequestTags).not.toHaveBeenCalled();
        expect(unchanged.loadCollectionsWithExpansionState).not.toHaveBeenCalled();
    });

    test('an emptied list clears the tags', async () => {
        const controller = makeController([]);
        await controller.handleEditTags(collection, { id: 'e1', tags: ['smoke'] });

        expect(controller.service.setRequestTags).toHaveBeenCalledWith('c1', 'e1', []);
    });

    test('a request without tags opens the dialog with an empty list', async () => {
        const controller = makeController(null);
        await controller.handleEditTags(collection, { id: 'e1' });

        expect(controller.editTagsDialog.show).toHaveBeenCalledWith([], expect.any(Object));
    });
});
