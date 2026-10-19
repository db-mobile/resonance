import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { CollectionService } from '../../src/modules/services/CollectionService.js';
import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';
import { toast } from '../../src/modules/ui/Toast.js';

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { success: jest.fn(), warning: jest.fn(), info: jest.fn(), error: jest.fn() }
}));

describe('Show in file manager', () => {
    test('routes from the controller through the service to the backend command', async () => {
        const backendAPI = { collections: { reveal: jest.fn().mockResolvedValue(undefined) } };
        const controller = Object.create(CollectionController.prototype);
        controller.service = new CollectionService(new CollectionRepository(backendAPI, null));

        await controller.handleReveal({ id: 'c1', name: 'Petstore' });

        expect(backendAPI.collections.reveal).toHaveBeenCalledWith('c1');
        expect(toast.error).not.toHaveBeenCalled();
    });

    test('a backend failure becomes a toast instead of an unhandled rejection', async () => {
        const backendAPI = { collections: { reveal: jest.fn().mockRejectedValue('Collection folder /gone does not exist') } };
        const controller = Object.create(CollectionController.prototype);
        controller.service = new CollectionService(new CollectionRepository(backendAPI, null));

        await controller.handleReveal({ id: 'c1', name: 'Petstore' });

        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
    });
});
