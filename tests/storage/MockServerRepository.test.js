import { MockServerRepository } from '../../src/modules/storage/MockServerRepository.js';

describe('MockServerRepository', () => {
    let backendAPI;
    let repository;

    const defaults = {
        port: 3000,
        enabledCollections: [],
        endpointDelays: {},
        customResponses: {},
        customStatusCodes: {}
    };

    beforeEach(() => {
        backendAPI = {
            store: {
                get: jest.fn().mockResolvedValue(null),
                set: jest.fn().mockResolvedValue(undefined)
            }
        };
        repository = new MockServerRepository(backendAPI);
    });

    describe('getSettings', () => {
        test('seeds and returns the defaults when nothing is stored', async () => {
            expect(await repository.getSettings()).toEqual(defaults);
            expect(backendAPI.store.set).toHaveBeenCalledWith('mockServer', defaults);
        });

        test('merges stored values over the defaults', async () => {
            backendAPI.store.get.mockResolvedValue({ port: 4000, endpointDelays: { 'c:e': 10 } });

            expect(await repository.getSettings()).toEqual({
                ...defaults,
                port: 4000,
                endpointDelays: { 'c:e': 10 }
            });
            expect(backendAPI.store.set).not.toHaveBeenCalled();
        });

        test('replaces malformed collections and maps with empty ones', async () => {
            backendAPI.store.get.mockResolvedValue({
                enabledCollections: 'x',
                endpointDelays: 'x',
                customResponses: null,
                customStatusCodes: 7
            });

            expect(await repository.getSettings()).toEqual(defaults);
        });

        test('wraps a storage failure', async () => {
            backendAPI.store.get.mockRejectedValue(new Error('disk'));

            await expect(repository.getSettings()).rejects.toThrow('Failed to load mock server settings: disk');
        });
    });

    describe('saveSettings', () => {
        test('validates every field before writing', async () => {
            const saved = await repository.saveSettings({
                port: '8080',
                enabledCollections: ['a', '', 3, ' '],
                endpointDelays: { ok: '15', neg: -1, big: 40000, nan: 'x' },
                customResponses: { obj: { a: 1 }, str: 's', num: 5 },
                customStatusCodes: { ok: '404', low: 99, high: 600, nan: 'x' }
            });

            expect(saved).toEqual({
                port: '8080',
                enabledCollections: ['a'],
                endpointDelays: { ok: 15 },
                customResponses: { obj: { a: 1 }, str: 's' },
                customStatusCodes: { ok: 404 }
            });
            expect(backendAPI.store.set).toHaveBeenCalledWith('mockServer', saved);
        });

        test('falls back to defaults for an invalid port and non-object maps', async () => {
            expect(await repository.saveSettings({ port: 80, endpointDelays: 'x', customResponses: 1, customStatusCodes: null })).toEqual(defaults);
        });

        test('rejects a non-object payload', async () => {
            await expect(repository.saveSettings(null)).rejects.toThrow('Failed to save mock server settings: Invalid mock server settings format');
        });
    });

    describe('updateSettings', () => {
        test('deep-merges the three keyed maps and shallow-merges the rest', async () => {
            backendAPI.store.get.mockResolvedValue({
                port: 3000,
                enabledCollections: ['a'],
                endpointDelays: { x: 1 },
                customResponses: { x: 'r' },
                customStatusCodes: { x: 201 }
            });

            const updated = await repository.updateSettings({
                enabledCollections: ['b'],
                endpointDelays: { y: 2 },
                customResponses: { y: 's' },
                customStatusCodes: { y: 202 }
            });

            expect(updated).toEqual({
                port: 3000,
                enabledCollections: ['b'],
                endpointDelays: { x: 1, y: 2 },
                customResponses: { x: 'r', y: 's' },
                customStatusCodes: { x: 201, y: 202 }
            });
        });

        test('wraps a failure', async () => {
            backendAPI.store.get.mockRejectedValue(new Error('disk'));

            await expect(repository.updateSettings({})).rejects.toThrow('Failed to update mock server settings: Failed to load mock server settings: disk');
        });
    });

    describe('keyed setters', () => {
        beforeEach(() => {
            backendAPI.store.get.mockResolvedValue({
                ...defaults,
                endpointDelays: { 'c1_e1': 100 },
                customResponses: { 'c1_e1': { a: 1 } },
                customStatusCodes: { 'c1_e1': 500 }
            });
        });

        test('setEndpointDelay stores a delay and clears it at zero', async () => {
            expect((await repository.setEndpointDelay('c1', 'e2', 250)).endpointDelays).toEqual({ 'c1_e1': 100, 'c1_e2': 250 });
            expect((await repository.setEndpointDelay('c1', 'e1', 0)).endpointDelays).toEqual({ 'c1_e2': 250 });
        });

        test('setEndpointDelay rejects an out-of-range delay', async () => {
            await expect(repository.setEndpointDelay('c1', 'e1', 30001)).rejects.toThrow(
                'Failed to set endpoint delay: Delay must be between 0 and 30000 milliseconds'
            );
        });

        test('setCustomResponse stores and clears on null', async () => {
            expect((await repository.setCustomResponse('c1', 'e2', 'body')).customResponses).toEqual({ 'c1_e1': { a: 1 }, 'c1_e2': 'body' });
            expect((await repository.setCustomResponse('c1', 'e1', null)).customResponses).toEqual({ 'c1_e2': 'body' });
        });

        test('setCustomStatusCode stores and clears on null', async () => {
            expect((await repository.setCustomStatusCode('c1', 'e2', 404)).customStatusCodes).toEqual({ 'c1_e1': 500, 'c1_e2': 404 });
            expect((await repository.setCustomStatusCode('c1', 'e1', null)).customStatusCodes).toEqual({ 'c1_e2': 404 });
        });

        test('getters read by endpoint key and fall back to null', async () => {
            expect(await repository.getCustomResponse('c1', 'e1')).toEqual({ a: 1 });
            expect(await repository.getCustomStatusCode('c1', 'e1')).toBe(500);
            expect(await repository.getCustomResponse('c1', 'zz')).toBeNull();

            backendAPI.store.get.mockRejectedValue(new Error('x'));
            expect(await repository.getCustomResponse('c1', 'e1')).toBeNull();
            expect(await repository.getCustomStatusCode('c1', 'e1')).toBeNull();
        });

        test('toggleCollectionEnabled adds then removes', async () => {
            expect((await repository.toggleCollectionEnabled('c9')).enabledCollections).toEqual(['c9']);
            backendAPI.store.get.mockResolvedValue({ ...defaults, enabledCollections: ['c9'] });
            expect((await repository.toggleCollectionEnabled('c9')).enabledCollections).toEqual([]);
        });
    });
});
