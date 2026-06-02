import { CertificateService } from '../../src/modules/services/CertificateService.js';

describe('CertificateService', () => {
    let service;
    let mockRepository;

    beforeEach(() => {
        mockRepository = {
            getCertificates: jest.fn(),
            saveCertificates: jest.fn(settings => Promise.resolve({ items: settings.items }))
        };
        service = new CertificateService(mockRepository);
    });

    describe('getForHost', () => {
        beforeEach(async () => {
            mockRepository.getCertificates.mockResolvedValue({
                items: [
                    { host: 'api.example.com', certPath: '/c.crt', keyPath: '/c.key', caPath: '', enabled: true },
                    { host: 'api.example.com:8443', certPath: '/p.crt', keyPath: '/p.key', caPath: '/ca.pem', enabled: true },
                    { host: 'disabled.example.com', certPath: '/d.crt', keyPath: '/d.key', caPath: '', enabled: false },
                    { host: 'ca-only.example.com', certPath: '', keyPath: '', caPath: '/ca.pem', enabled: true }
                ]
            });
            await service.getItems(); // warm the cache
        });

        test('returns null before the cache is warmed', () => {
            const cold = new CertificateService(mockRepository);
            expect(cold.getForHost('api.example.com')).toBeNull();
        });

        test('prefers an exact host:port match over a bare host match', () => {
            expect(service.getForHost('api.example.com:8443')).toEqual({
                certPath: '/p.crt', keyPath: '/p.key', caPath: '/ca.pem'
            });
        });

        test('falls back to a bare host match', () => {
            expect(service.getForHost('api.example.com:9999')).toEqual({
                certPath: '/c.crt', keyPath: '/c.key', caPath: ''
            });
        });

        test('is case-insensitive on host', () => {
            expect(service.getForHost('API.EXAMPLE.COM')).not.toBeNull();
        });

        test('ignores disabled entries', () => {
            expect(service.getForHost('disabled.example.com')).toBeNull();
        });

        test('matches a CA-only entry', () => {
            expect(service.getForHost('ca-only.example.com')).toEqual({
                certPath: '', keyPath: '', caPath: '/ca.pem'
            });
        });

        test('returns null for an unknown host', () => {
            expect(service.getForHost('other.example.com')).toBeNull();
        });
    });

    describe('validateEntry', () => {
        test('requires a host', () => {
            expect(service.validateEntry({ host: '' })).toContain('Host is required');
        });

        test('requires both cert and key together', () => {
            const errors = service.validateEntry({ host: 'h', certPath: '/c.crt', keyPath: '' });
            expect(errors.some(e => e.includes('key file'))).toBe(true);
        });

        test('accepts a CA-only entry', () => {
            expect(service.validateEntry({ host: 'h', caPath: '/ca.pem' })).toEqual([]);
        });
    });

    describe('saveItems', () => {
        test('persists and notifies listeners', async () => {
            const listener = jest.fn();
            service.addChangeListener(listener);

            const items = [{ host: 'h', certPath: '/c.crt', keyPath: '/c.key', caPath: '', enabled: true }];
            const saved = await service.saveItems(items);

            expect(mockRepository.saveCertificates).toHaveBeenCalledWith({ items });
            expect(saved).toEqual(items);
            expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'certificates-updated' }));
            // cache is refreshed so resolution works immediately after save
            expect(service.getForHost('h')).toEqual({ certPath: '/c.crt', keyPath: '/c.key', caPath: '' });
        });
    });
});
