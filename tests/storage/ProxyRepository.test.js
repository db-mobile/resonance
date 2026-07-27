import { ProxyRepository } from '../../src/modules/storage/ProxyRepository.js';

describe('ProxyRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn().mockResolvedValue()
            },
            proxySettings: {
                set: jest.fn(settings => Promise.resolve(settings))
            }
        };
        repository = new ProxyRepository(mockBackendAPI);
    });

    const validSettings = () => ({
        enabled: true,
        useSystemProxy: false,
        type: 'socks5',
        host: 'proxy.example.com',
        port: 1080,
        auth: { enabled: true, username: 'u', password: 'p' },
        bypassList: ['localhost'],
        timeout: 5000
    });

    describe('saveProxySettings', () => {
        test('writes through proxy_set so the live backend state updates', async () => {
            await repository.saveProxySettings(validSettings());

            expect(mockBackendAPI.proxySettings.set).toHaveBeenCalledTimes(1);
            expect(mockBackendAPI.proxySettings.set).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: true, type: 'socks5', port: 1080 })
            );
            expect(mockBackendAPI.store.set).not.toHaveBeenCalled();
        });

        test('coerces a string port and timeout to numbers', async () => {
            await repository.saveProxySettings({
                ...validSettings(),
                port: '8080',
                timeout: '15000'
            });

            const saved = mockBackendAPI.proxySettings.set.mock.calls[0][0];
            expect(saved.port).toBe(8080);
            expect(saved.timeout).toBe(15000);
        });

        test('falls back to defaults for an out-of-range port and timeout', async () => {
            await repository.saveProxySettings({
                ...validSettings(),
                port: 70000,
                timeout: 999999
            });

            const saved = mockBackendAPI.proxySettings.set.mock.calls[0][0];
            expect(saved.port).toBe(8080);
            expect(saved.timeout).toBe(10000);
        });

        test('rejects a non-object payload', async () => {
            await expect(repository.saveProxySettings(null)).rejects.toThrow(
                /Invalid proxy settings format/
            );
            expect(mockBackendAPI.proxySettings.set).not.toHaveBeenCalled();
        });
    });

    describe('resetToDefaults', () => {
        test('writes the defaults through proxy_set', async () => {
            const result = await repository.resetToDefaults();

            expect(mockBackendAPI.proxySettings.set).toHaveBeenCalledTimes(1);
            expect(mockBackendAPI.store.set).not.toHaveBeenCalled();
            expect(result).toEqual(
                expect.objectContaining({ enabled: false, type: 'http', port: 8080 })
            );
        });
    });

    describe('getProxySettings', () => {
        test('seeds defaults through proxy_set when storage is empty', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getProxySettings();

            expect(result).toEqual(
                expect.objectContaining({ enabled: false, type: 'http', port: 8080 })
            );
            expect(mockBackendAPI.proxySettings.set).toHaveBeenCalledTimes(1);
            expect(mockBackendAPI.store.set).not.toHaveBeenCalled();
        });

        test('merges stored settings over the defaults', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ enabled: true, host: 'p.example' });

            const result = await repository.getProxySettings();

            expect(result.enabled).toBe(true);
            expect(result.host).toBe('p.example');
            expect(result.port).toBe(8080);
            expect(result.bypassList).toEqual([]);
        });
    });

    describe('toggleProxyEnabled', () => {
        test('flips the flag and persists through proxy_set', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ ...validSettings(), enabled: false });

            const enabled = await repository.toggleProxyEnabled();

            expect(enabled).toBe(true);
            expect(mockBackendAPI.proxySettings.set).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: true })
            );
        });
    });
});
