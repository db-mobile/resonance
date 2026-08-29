import { WorkspaceTabService } from '../../src/modules/services/WorkspaceTabService.js';

describe('WorkspaceTabService status display', () => {
    test('the last-tab guard reports through the adapter update method', async () => {
        const statusDisplay = { update: jest.fn() };
        const repository = { getTabs: jest.fn().mockResolvedValue([{ id: 'tab-1' }]) };
        const service = new WorkspaceTabService(repository, statusDisplay);

        const result = await service.closeTab('tab-1');

        expect(result).toBeNull();
        expect(statusDisplay.update).toHaveBeenCalledWith('Cannot close the last tab', null);
    });

    test('initialization failures report through update and rethrow', async () => {
        const statusDisplay = { update: jest.fn() };
        const repository = { getTabs: jest.fn().mockRejectedValue(new Error('boom')) };
        const service = new WorkspaceTabService(repository, statusDisplay);

        await expect(service.initialize()).rejects.toThrow('boom');
        expect(statusDisplay.update).toHaveBeenCalledWith('Error initializing workspace tabs', null);
    });
});
