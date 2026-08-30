import { CollectionRepository } from '../../src/modules/storage/CollectionRepository.js';

describe('CollectionRepository endpoint write serialization', () => {
    let repository;
    let backendAPI;
    let stored;

    beforeEach(() => {
        stored = { existing: 'kept' };
        backendAPI = {
            collections: {
                getEndpointData: jest.fn(async () => ({ ...stored })),
                saveEndpointData: jest.fn(async (collectionId, endpointId, data) => {
                    stored = data;
                })
            }
        };
        repository = new CollectionRepository(backendAPI);
    });

    test('overlapping field updates on the same endpoint both land', async () => {
        await Promise.all([
            repository.updateEndpointFields('col', 'ep', { url: 'https://a.example' }),
            repository.updateEndpointFields('col', 'ep', { headers: [{ key: 'X', value: '1' }] })
        ]);

        expect(stored).toEqual({
            existing: 'kept',
            url: 'https://a.example',
            headers: [{ key: 'X', value: '1' }]
        });
    });

    test('writes to different endpoints are not serialized against each other', async () => {
        let releaseFirstRead;
        backendAPI.collections.getEndpointData
            .mockImplementationOnce(() => new Promise((resolve) => {
                releaseFirstRead = () => resolve({});
            }))
            .mockImplementationOnce(async () => ({}));

        const first = repository.updateEndpointFields('col', 'ep-1', { url: 'one' });
        const second = repository.updateEndpointFields('col', 'ep-2', { url: 'two' });

        await second;
        expect(backendAPI.collections.saveEndpointData).toHaveBeenCalledWith('col', 'ep-2', { url: 'two' });

        releaseFirstRead();
        await first;
        expect(backendAPI.collections.saveEndpointData).toHaveBeenCalledWith('col', 'ep-1', { url: 'one' });
    });

    test('a failed read aborts the write instead of wiping the sidecar', async () => {
        backendAPI.collections.getEndpointData.mockRejectedValueOnce(new Error('disk gone'));

        await expect(
            repository.updateEndpointFields('col', 'ep', { url: 'https://a.example' })
        ).rejects.toThrow('Failed to update endpoint fields');

        expect(backendAPI.collections.saveEndpointData).not.toHaveBeenCalled();
    });

    test('a failed write does not block the next queued write', async () => {
        backendAPI.collections.saveEndpointData.mockRejectedValueOnce(new Error('write denied'));

        await expect(
            repository.updateEndpointFields('col', 'ep', { url: 'first' })
        ).rejects.toThrow('Failed to update endpoint fields');

        await repository.updateEndpointFields('col', 'ep', { url: 'second' });

        expect(stored).toEqual({ existing: 'kept', url: 'second' });
    });
});
