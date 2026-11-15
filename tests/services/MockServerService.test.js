/* global window */
import { MockServerService } from '../../src/modules/services/MockServerService.js';

describe('MockServerService', () => {
    let repository;
    let statusDisplay;
    let service;
    let mockServerApi;

    beforeEach(() => {
        repository = {
            getSettings: jest.fn().mockResolvedValue({ port: 3000, enabledCollections: ['c1'] }),
            updateSettings: jest.fn().mockResolvedValue({ port: 4000 }),
            setEndpointDelay: jest.fn().mockResolvedValue({ ok: 'delay' }),
            setCustomResponse: jest.fn().mockResolvedValue({ ok: 'response' }),
            getCustomResponse: jest.fn().mockResolvedValue({ body: 1 }),
            setCustomStatusCode: jest.fn().mockResolvedValue({ ok: 'status' }),
            getCustomStatusCode: jest.fn().mockResolvedValue(201),
            toggleCollectionEnabled: jest.fn().mockResolvedValue({ enabledCollections: ['c1'] })
        };
        statusDisplay = { update: jest.fn() };
        mockServerApi = {
            start: jest.fn().mockResolvedValue({ success: true, port: 3000 }),
            stop: jest.fn().mockResolvedValue({ success: true }),
            status: jest.fn().mockResolvedValue({ running: false, port: null }),
            logs: jest.fn().mockResolvedValue([{ id: 1 }]),
            clearLogs: jest.fn().mockResolvedValue({ success: true }),
            reloadSettings: jest.fn().mockResolvedValue(undefined)
        };
        window.backendAPI = { mockServer: mockServerApi };
        service = new MockServerService(repository, statusDisplay);
    });

    afterEach(() => {
        delete window.backendAPI;
    });

    describe('startServer / stopServer', () => {
        test('starts with enabled collections and emits running', async () => {
            const seen = [];
            service.addChangeListener(status => seen.push(status));

            const result = await service.startServer([{ id: 'c1' }, { id: 'c2' }]);

            expect(mockServerApi.start).toHaveBeenCalledWith({ port: 3000, enabledCollections: ['c1'] }, [{ id: 'c1' }]);
            expect(result).toEqual({ success: true, port: 3000 });
            expect(statusDisplay.update).toHaveBeenCalledWith('Mock server started on port 3000', null);
            expect(seen).toEqual([{ running: true, port: 3000 }]);
        });

        test('refuses to start without enabled collections', async () => {
            await expect(service.startServer([{ id: 'other' }])).rejects.toThrow('No collections enabled. Please enable at least one collection.');
            expect(statusDisplay.update).toHaveBeenCalledWith('No collections enabled. Please enable at least one collection.', null);
            expect(mockServerApi.start).not.toHaveBeenCalled();
        });

        test('reports a failed start without throwing', async () => {
            mockServerApi.start.mockResolvedValue({ success: false, message: 'port busy' });

            await service.startServer([{ id: 'c1' }]);

            expect(statusDisplay.update).toHaveBeenCalledWith('Failed to start mock server: port busy', null);
        });

        test('stop emits not running', async () => {
            const seen = [];
            service.addChangeListener(status => seen.push(status));

            await service.stopServer();

            expect(statusDisplay.update).toHaveBeenCalledWith('Mock server stopped', null);
            expect(seen).toEqual([{ running: false, port: null }]);
        });

        test('stop reports a transport failure and rethrows', async () => {
            mockServerApi.stop.mockRejectedValue(new Error('gone'));

            await expect(service.stopServer()).rejects.toThrow('gone');
            expect(statusDisplay.update).toHaveBeenCalledWith('gone', null);
        });
    });

    describe('status and logs', () => {
        test('getStatus falls back when the backend fails', async () => {
            mockServerApi.status.mockRejectedValue(new Error('x'));

            expect(await service.getStatus()).toEqual({ running: false, port: null, requestCount: 0 });
        });

        test('shouldUseMockServer only when running and enabled', async () => {
            expect(await service.shouldUseMockServer('c1')).toEqual({ shouldUseMock: false, mockBaseUrl: null });

            mockServerApi.status.mockResolvedValue({ running: true, port: 3005, loadedCollectionIds: ['c1'] });
            expect(await service.shouldUseMockServer('c1')).toEqual({ shouldUseMock: true, mockBaseUrl: 'http://localhost:3005' });
            expect(await service.shouldUseMockServer('c9')).toEqual({ shouldUseMock: false, mockBaseUrl: null });
        });

        test('getRequestLogs falls back to an empty list', async () => {
            expect(await service.getRequestLogs(5)).toEqual([{ id: 1 }]);
            expect(mockServerApi.logs).toHaveBeenCalledWith(5);

            mockServerApi.logs.mockRejectedValue(new Error('x'));
            expect(await service.getRequestLogs()).toEqual([]);
        });
    });

    describe('settings', () => {
        test('getSettings reports and rethrows', async () => {
            expect(await service.getSettings()).toEqual({ port: 3000, enabledCollections: ['c1'] });

            repository.getSettings.mockRejectedValue(new Error('corrupt'));
            await expect(service.getSettings()).rejects.toThrow('corrupt');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error loading mock server settings: corrupt', null);
        });

        test('updateSettings reports and asks for a restart on port change while running', async () => {
            mockServerApi.status.mockResolvedValue({ running: true, port: 3000 });

            const result = await service.updateSettings({ port: 4000 });

            expect(result).toEqual({ port: 4000 });
            expect(statusDisplay.update.mock.calls).toEqual([
                ['Mock server settings updated', null],
                ['Port changed. Please restart the mock server for changes to take effect.', null]
            ]);
        });

        test('updateSettings without a port change does not mention a restart', async () => {
            mockServerApi.status.mockResolvedValue({ running: true, port: 3000 });

            await service.updateSettings({ enabledCollections: [] });

            expect(statusDisplay.update).toHaveBeenCalledTimes(1);
        });

        test('updateSettings reports a failure', async () => {
            repository.updateSettings.mockRejectedValue(new Error('bad'));

            await expect(service.updateSettings({})).rejects.toThrow('bad');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error updating mock server settings: bad', null);
        });
    });

    describe('per-endpoint overrides', () => {
        test('setEndpointDelay validates, saves and reloads a running server', async () => {
            mockServerApi.status.mockResolvedValue({ running: true, port: 3000 });

            expect(await service.setEndpointDelay('c1', 'e1', 250)).toEqual({ ok: 'delay' });
            expect(repository.setEndpointDelay).toHaveBeenCalledWith('c1', 'e1', 250);
            expect(mockServerApi.reloadSettings).toHaveBeenCalledWith({ port: 3000, enabledCollections: ['c1'] });
        });

        test('setEndpointDelay rejects an invalid delay with the validation text', async () => {
            await expect(service.setEndpointDelay('c1', 'e1', 50000)).rejects.toThrow('Delay cannot exceed 30000ms (30 seconds)');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error setting endpoint delay: Delay cannot exceed 30000ms (30 seconds)', null);
            expect(repository.setEndpointDelay).not.toHaveBeenCalled();
        });

        test('setCustomResponse and setCustomStatusCode save without reloading a stopped server', async () => {
            expect(await service.setCustomResponse('c1', 'e1', { body: 1 })).toEqual({ ok: 'response' });
            expect(await service.setCustomStatusCode('c1', 'e1', 201)).toEqual({ ok: 'status' });
            expect(mockServerApi.reloadSettings).not.toHaveBeenCalled();
        });

        test.each([
            ['setCustomResponse', 'Error setting custom response: bad'],
            ['setCustomStatusCode', 'Error setting custom status code: bad']
        ])('%s reports a failure', async (method, text) => {
            repository[method].mockRejectedValue(new Error('bad'));

            await expect(service[method]('c1', 'e1', null)).rejects.toThrow('bad');
            expect(statusDisplay.update).toHaveBeenCalledWith(text, null);
        });

        test('getters fall back to null', async () => {
            expect(await service.getCustomResponse('c1', 'e1')).toEqual({ body: 1 });
            expect(await service.getCustomStatusCode('c1', 'e1')).toBe(201);

            repository.getCustomResponse.mockRejectedValue(new Error('x'));
            repository.getCustomStatusCode.mockRejectedValue(new Error('x'));
            expect(await service.getCustomResponse('c1', 'e1')).toBeNull();
            expect(await service.getCustomStatusCode('c1', 'e1')).toBeNull();
        });

        test('toggleCollectionEnabled returns the new state and reports failures', async () => {
            expect(await service.toggleCollectionEnabled('c1')).toBe(true);
            expect(await service.toggleCollectionEnabled('c2')).toBe(false);

            repository.toggleCollectionEnabled.mockRejectedValue(new Error('bad'));
            await expect(service.toggleCollectionEnabled('c1')).rejects.toThrow('bad');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error toggling collection: bad', null);
        });

        test('a reload failure is swallowed', async () => {
            mockServerApi.status.mockResolvedValue({ running: true, port: 3000 });
            mockServerApi.reloadSettings.mockRejectedValue(new Error('x'));

            await expect(service.setCustomResponse('c1', 'e1', null)).resolves.toEqual({ ok: 'response' });
        });
    });

    describe('live collection toggles', () => {
        let saved;
        let loaded;
        let collections;
        let reload;

        const clone = value => JSON.parse(JSON.stringify(value));
        const tick = () => new Promise(resolve => setTimeout(resolve, 0));

        beforeEach(() => {
            saved = { port: 3000, enabledCollections: ['c1'] };
            loaded = ['c1'];
            collections = [
                { id: 'c1', endpoints: [{ id: 'e1', path: '/one' }] },
                { id: 'c2', endpoints: [{ id: 'e2', path: '/two' }] }
            ];
            repository.getSettings.mockImplementation(async () => clone(saved));
            repository.saveSettings = jest.fn(async settings => {
                saved = clone(settings);
                return clone(saved);
            });
            repository.toggleCollectionEnabled.mockImplementation(async id => {
                const ids = saved.enabledCollections;
                saved = { ...saved, enabledCollections: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] };
                return clone(saved);
            });
            mockServerApi.status.mockImplementation(async () => ({
                running: true, port: 3000, loadedCollectionIds: [...loaded]
            }));
            reload = async (settings, snapshots) => {
                loaded = snapshots.map(collection => collection.id);
                return { success: true };
            };
            mockServerApi.reloadSettings.mockImplementation((...args) => reload(...args));
            service = new MockServerService(repository, statusDisplay, async () => collections);
        });

        test('enabling an unloaded collection loads its routes before reporting success', async () => {
            expect(await service.toggleCollectionEnabled('c2')).toBe(true);

            expect(loaded).toEqual(['c1', 'c2']);
            expect(mockServerApi.reloadSettings).toHaveBeenCalledWith(saved, collections);
            expect(await service.shouldUseMockServer('c2')).toEqual({ shouldUseMock: true, mockBaseUrl: 'http://localhost:3000' });
        });

        test('a toggle waits for an in-progress start before replacing routes', async () => {
            let running = false;
            mockServerApi.status.mockImplementation(async () => ({ running, port: 3000, loadedCollectionIds: [...loaded] }));
            loaded = [];
            let releaseStart;
            let signalStarted;
            const started = new Promise(resolve => { signalStarted = resolve; });
            window.backendAPI.mockServer.start.mockImplementation(async (_settings, snapshots) => {
                signalStarted();
                await new Promise(resolve => { releaseStart = resolve; });
                running = true;
                loaded = snapshots.map(collection => collection.id);
                return { success: true, port: 3000 };
            });
            const start = service.startServer(collections);
            await started;
            const toggle = service.toggleCollectionEnabled('c2');
            releaseStart();
            await Promise.all([start, toggle]);
            expect(loaded).toEqual(['c1', 'c2']);
            expect(saved.enabledCollections).toEqual(['c1', 'c2']);
        });

        test('routing follows acknowledged runtime membership during a reload', async () => {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            reload = async (_settings, snapshots) => {
                await gate;
                loaded = snapshots.map(collection => collection.id);
                return { success: true };
            };
            const toggle = service.toggleCollectionEnabled('c2');
            await tick();
            const beforeReload = await service.shouldUseMockServer('c2');
            release();
            await toggle;

            expect(beforeReload).toEqual({ shouldUseMock: false, mockBaseUrl: null });
            expect(await service.shouldUseMockServer('c2')).toEqual({ shouldUseMock: true, mockBaseUrl: 'http://localhost:3000' });
        });

        test('a saved toggle cannot redirect to a collection absent from the runtime', async () => {
            saved.enabledCollections.push('c2');
            expect(await service.shouldUseMockServer('c2')).toEqual({ shouldUseMock: false, mockBaseUrl: null });

            saved.enabledCollections = [];
            expect(await service.shouldUseMockServer('c1')).toEqual({ shouldUseMock: true, mockBaseUrl: 'http://localhost:3000' });
        });

        test('disabling the last collection removes routes without stopping the server', async () => {
            expect(await service.toggleCollectionEnabled('c1')).toBe(false);

            expect(saved.enabledCollections).toEqual([]);
            expect(loaded).toEqual([]);
            expect(mockServerApi.stop).not.toHaveBeenCalled();
            expect(await service.shouldUseMockServer('c1')).toEqual({ shouldUseMock: false, mockBaseUrl: null });
        });

        test('rapid toggles wait for the preceding reload and preserve the final intent', async () => {
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            let reloadCount = 0;
            reload = async (_settings, snapshots) => {
                if (++reloadCount === 1) { await gate; }
                loaded = snapshots.map(collection => collection.id);
                return { success: true };
            };
            const enable = service.toggleCollectionEnabled('c2');
            await tick();
            const disable = service.toggleCollectionEnabled('c2');
            await tick();
            const pendingSaved = clone(saved);
            release();
            await expect(Promise.all([enable, disable])).resolves.toEqual([true, false]);

            expect(pendingSaved.enabledCollections).toEqual(['c1', 'c2']);
            expect(saved.enabledCollections).toEqual(['c1']);
            expect(loaded).toEqual(['c1']);
            expect(reloadCount).toBe(2);
        });

        test.each(['transport', 'rejected', 'stopped'])('a %s reload failure restores saved settings and keeps old routing', async kind => {
            reload = async () => {
                if (kind === 'transport') { throw new Error('reload failed'); }
                return { success: false, message: kind === 'stopped' ? 'Server is not running' : 'reload failed' };
            };

            await expect(service.toggleCollectionEnabled('c2')).rejects.toThrow();

            expect(saved.enabledCollections).toEqual(['c1']);
            expect(loaded).toEqual(['c1']);
            expect(await service.shouldUseMockServer('c2')).toEqual({ shouldUseMock: false, mockBaseUrl: null });
            expect(statusDisplay.update).toHaveBeenCalledWith(expect.stringContaining('Error toggling collection:'), null);
        });

        test('a failed reload does not prevent a subsequent toggle', async () => {
            mockServerApi.reloadSettings.mockRejectedValueOnce(new Error('temporary failure'));
            await expect(service.toggleCollectionEnabled('c2')).rejects.toThrow('temporary failure');

            await expect(service.toggleCollectionEnabled('c2')).resolves.toBe(true);
            expect(saved.enabledCollections).toEqual(['c1', 'c2']);
            expect(loaded).toEqual(['c1', 'c2']);
        });
    });

    describe('validators', () => {
        test('validatePort', () => {
            expect(service.validatePort('abc')).toEqual(['Port must be a number']);
            expect(service.validatePort(80)).toEqual(['Port must be 1024 or higher (avoiding system ports)']);
            expect(service.validatePort(70000)).toEqual(['Port must be 65535 or lower']);
            expect(service.validatePort(1024)).toEqual([]);
            expect(service.validatePort(65535)).toEqual([]);
        });

        test('validateDelay', () => {
            expect(service.validateDelay('x')).toEqual(['Delay must be a number']);
            expect(service.validateDelay(-1)).toEqual(['Delay cannot be negative']);
            expect(service.validateDelay(30001)).toEqual(['Delay cannot exceed 30000ms (30 seconds)']);
            expect(service.validateDelay(0)).toEqual([]);
            expect(service.validateDelay(30000)).toEqual([]);
        });

        test('validateStatusCode', () => {
            expect(service.validateStatusCode('x')).toEqual(['Status code must be a number']);
            expect(service.validateStatusCode(99)).toEqual(['Status code must be between 100 and 599']);
            expect(service.validateStatusCode(600)).toEqual(['Status code must be between 100 and 599']);
            expect(service.validateStatusCode(100)).toEqual([]);
            expect(service.validateStatusCode(599)).toEqual([]);
        });
    });
});
