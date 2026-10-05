import { ProxyService } from '../../src/modules/services/ProxyService.js';

describe('ProxyService', () => {
    let repository;
    let service;

    beforeEach(() => {
        repository = {
            getProxySettings: jest.fn().mockResolvedValue({ enabled: false }),
            saveProxySettings: jest.fn(async settings => ({ ...settings, saved: true }))
        };
        service = new ProxyService(repository, { update: jest.fn() });
    });

    test('getSettings delegates to the repository', async () => {
        expect(await service.getSettings()).toEqual({ enabled: false });
    });

    test('updateSettings validates, saves and notifies listeners with the raw settings', async () => {
        const seen = [];
        service.addChangeListener(settings => seen.push(settings));
        const settings = { enabled: true, type: 'http', host: 'proxy.local', port: 8080 };

        const result = await service.updateSettings(settings);

        expect(repository.saveProxySettings).toHaveBeenCalledWith(settings);
        expect(result).toEqual({ ...settings, saved: true });
        expect(seen).toEqual([settings]);
    });

    test('updateSettings joins validation errors with a semicolon', async () => {
        await expect(service.updateSettings({ type: 'ftp', port: 0 })).rejects.toThrow(
            'Invalid proxy type. Must be: http, https, socks4, or socks5; Invalid port number. Must be between 1 and 65535'
        );
        expect(repository.saveProxySettings).not.toHaveBeenCalled();
    });

    describe('validateSettings', () => {
        test('rejects a non-object', () => {
            expect(service.validateSettings(null)).toEqual(['Invalid settings format']);
        });

        test('checks the host only for an enabled explicit proxy', () => {
            expect(service.validateSettings({ enabled: true, host: 'bad host!' })).toEqual(['Invalid proxy host format']);
            expect(service.validateSettings({ enabled: true, host: 42 })).toEqual(['Invalid proxy host format']);
            expect(service.validateSettings({ enabled: true, useSystemProxy: true, host: 'bad host!' })).toEqual([]);
            expect(service.validateSettings({ enabled: false, host: 'bad host!' })).toEqual([]);
            expect(service.validateSettings({ enabled: true, host: '   ' })).toEqual([]);
        });

        test('requires a username when auth is enabled', () => {
            expect(service.validateSettings({ auth: { enabled: true, username: ' ' } })).toEqual([
                'Username is required when proxy authentication is enabled'
            ]);
            expect(service.validateSettings({ auth: { enabled: true, username: 'u' } })).toEqual([]);
        });

        test('checks the bypass list and timeout', () => {
            expect(service.validateSettings({ bypassList: 'x', timeout: 300001 })).toEqual([
                'Bypass list must be an array',
                'Invalid timeout. Must be between 0 and 300000ms (5 minutes)'
            ]);
            expect(service.validateSettings({ bypassList: [], timeout: 0 })).toEqual([]);
        });
    });

    describe('isValid*', () => {
        test('isValidProxyType', () => {
            expect(['http', 'https', 'socks4', 'socks5'].every(type => service.isValidProxyType(type))).toBe(true);
            expect(service.isValidProxyType('ftp')).toBe(false);
        });

        test('isValidHost accepts hostnames and IPv4 with or without a scheme', () => {
            expect(service.isValidHost('proxy.example.com')).toBe(true);
            expect(service.isValidHost('http://10.0.0.1')).toBe(true);
            expect(service.isValidHost('socks5://proxy')).toBe(true);
            expect(service.isValidHost('')).toBe(false);
            expect(service.isValidHost(null)).toBe(false);
            expect(service.isValidHost('bad host')).toBe(false);
        });

        test('isValidPort and isValidTimeout bounds', () => {
            expect(service.isValidPort(1)).toBe(true);
            expect(service.isValidPort(65535)).toBe(true);
            expect(service.isValidPort(0)).toBe(false);
            expect(service.isValidPort(65536)).toBe(false);
            expect(service.isValidPort('x')).toBe(false);
            expect(service.isValidTimeout(0)).toBe(true);
            expect(service.isValidTimeout(300000)).toBe(true);
            expect(service.isValidTimeout(-1)).toBe(false);
            expect(service.isValidTimeout(300001)).toBe(false);
            expect(service.isValidTimeout('x')).toBe(false);
        });
    });
});
