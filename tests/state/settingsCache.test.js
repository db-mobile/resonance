/* global window */

async function loadModule(get = jest.fn(async () => ({})), set = jest.fn(async () => {})) {
    jest.resetModules();
    window.backendAPI = { settings: { get, set } };
    const module = await import('../../src/modules/state/settingsCache.js');
    return { module, get, set };
}

describe('settingsCache', () => {
    describe('getSettings', () => {
        it('hits the backend once and serves later reads from the cache', async () => {
            const get = jest.fn(async () => ({ verifySsl: false }));
            const { module } = await loadModule(get);

            expect(await module.getSettings()).toEqual({ verifySsl: false });
            expect(await module.getSettings()).toEqual({ verifySsl: false });
            expect(get).toHaveBeenCalledTimes(1);
        });

        it('hits the backend again after the cache is invalidated', async () => {
            const get = jest.fn(async () => ({ verifySsl: true }));
            const { module } = await loadModule(get);

            await module.getSettings();
            module.invalidateSettingsCache();
            await module.getSettings();

            expect(get).toHaveBeenCalledTimes(2);
        });

        it('exposes the warm cache synchronously and null while cold', async () => {
            const { module } = await loadModule(jest.fn(async () => ({ a: 1 })));

            expect(module.getSettingsCache()).toBeNull();
            await module.getSettings();
            expect(module.getSettingsCache()).toEqual({ a: 1 });
        });
    });

    describe('resolveRequestSettings', () => {
        it('maps saved values onto the request fields', async () => {
            const { module } = await loadModule(jest.fn(async () => ({
                httpVersion: 'http2',
                requestTimeout: 5000,
                verifySsl: false,
                followRedirects: false
            })));

            expect(await module.resolveRequestSettings()).toEqual({
                httpVersion: 'http2',
                timeout: 5000,
                verifySsl: false,
                followRedirects: false
            });
        });

        it('treats a zero timeout as no timeout', async () => {
            const { module } = await loadModule(jest.fn(async () => ({ requestTimeout: 0 })));

            expect((await module.resolveRequestSettings()).timeout).toBeNull();
        });

        it('falls back to the legacy timeout key', async () => {
            const { module } = await loadModule(jest.fn(async () => ({ timeout: 1234 })));

            expect((await module.resolveRequestSettings()).timeout).toBe(1234);
        });

        it('defaults every field when the settings are empty', async () => {
            const { module } = await loadModule(jest.fn(async () => ({})));

            expect(await module.resolveRequestSettings()).toEqual({
                httpVersion: 'auto',
                timeout: 30000,
                verifySsl: true,
                followRedirects: true
            });
        });

        it('returns the defaults instead of throwing when the backend fails', async () => {
            const { module } = await loadModule(jest.fn(async () => {
                throw new Error('store unavailable');
            }));

            expect(await module.resolveRequestSettings()).toEqual({
                httpVersion: 'auto',
                timeout: 30000,
                verifySsl: true,
                followRedirects: true
            });
        });
    });

    describe('updateSetting', () => {
        it('writes one key back through the backend and invalidates the cache', async () => {
            const get = jest.fn(async () => ({ verifySsl: true, other: 'keep' }));
            const set = jest.fn(async () => {});
            const { module } = await loadModule(get, set);

            await module.getSettings();
            expect(await module.updateSetting('verifySsl', false)).toBe(true);

            expect(set).toHaveBeenCalledWith({ verifySsl: false, other: 'keep' });
            expect(module.getSettingsCache()).toBeNull();
        });

        it('reports failure instead of throwing when the write fails', async () => {
            const set = jest.fn(async () => {
                throw new Error('disk full');
            });
            const { module } = await loadModule(jest.fn(async () => ({})), set);

            expect(await module.updateSetting('verifySsl', false)).toBe(false);
        });

        it('serialises concurrent writes so neither one is lost', async () => {
            let stored = { a: 0, b: 0 };
            const get = jest.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return { ...stored };
            });
            const set = jest.fn(async (settings) => {
                stored = settings;
            });
            const { module } = await loadModule(get, set);

            await Promise.all([module.updateSetting('a', 1), module.updateSetting('b', 2)]);

            expect(stored).toEqual({ a: 1, b: 2 });
        });

        it('keeps writing after a failed write', async () => {
            const set = jest.fn()
                .mockRejectedValueOnce(new Error('disk full'))
                .mockResolvedValue(undefined);
            const { module } = await loadModule(jest.fn(async () => ({})), set);

            expect(await module.updateSetting('a', 1)).toBe(false);
            expect(await module.updateSetting('b', 2)).toBe(true);
        });
    });
});
