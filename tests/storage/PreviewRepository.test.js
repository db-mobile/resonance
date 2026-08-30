import { PreviewRepository } from '../../src/modules/storage/PreviewRepository.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PreviewRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn().mockResolvedValue({ 'tab-A': true, 'tab-B': false }),
                set: jest.fn().mockResolvedValue(undefined)
            }
        };
        repository = new PreviewRepository(mockBackendAPI);
    });

    test('load hydrates the cache and getPreviewMode reads the stored flag', async () => {
        await repository.load();

        expect(repository.getPreviewMode('tab-A')).toBe(true);
        expect(repository.getPreviewMode('tab-B')).toBe(false);
        expect(repository.getPreviewMode('tab-unknown')).toBe(false);
    });

    test('getPreviewMode before hydration returns false without throwing', () => {
        expect(repository.getPreviewMode('tab-A')).toBe(false);
    });

    test('setPreviewMode preserves other tabs\' entries', async () => {
        await repository.load();

        repository.setPreviewMode('tab-C', true);
        await flushMicrotasks();

        expect(mockBackendAPI.store.set).toHaveBeenCalledWith('previewModes', {
            'tab-A': true,
            'tab-B': false,
            'tab-C': true
        });
        expect(repository.getPreviewMode('tab-A')).toBe(true);
    });

    test('removePreviewMode deletes only its own key', async () => {
        await repository.load();

        repository.removePreviewMode('tab-A');
        await flushMicrotasks();

        expect(mockBackendAPI.store.set).toHaveBeenCalledWith('previewModes', { 'tab-B': false });
        expect(repository.getPreviewMode('tab-A')).toBe(false);
    });

    test('a failed load leaves an empty usable cache', async () => {
        mockBackendAPI.store.get.mockRejectedValueOnce(new Error('store locked'));

        await repository.load();

        expect(repository.getPreviewMode('tab-A')).toBe(false);
        repository.setPreviewMode('tab-A', true);
        expect(repository.getPreviewMode('tab-A')).toBe(true);
    });

    test('writes are ordered even when an earlier write resolves late', async () => {
        await repository.load();

        let releaseFirstWrite;
        const started = [];
        mockBackendAPI.store.set
            .mockImplementationOnce((key, value) => {
                started.push(value);
                return new Promise((resolve) => {
                    releaseFirstWrite = resolve;
                });
            })
            .mockImplementation((key, value) => {
                started.push(value);
                return Promise.resolve();
            });

        repository.setPreviewMode('tab-C', true);
        repository.setPreviewMode('tab-D', true);
        await flushMicrotasks();

        expect(started).toHaveLength(1);
        expect(started[0]).not.toHaveProperty('tab-D');

        releaseFirstWrite();
        await flushMicrotasks();

        expect(started).toHaveLength(2);
        expect(started[1]).toMatchObject({ 'tab-C': true, 'tab-D': true });
    });
});
