import { CertificateRepository } from '../../src/modules/storage/CertificateRepository.js';

describe('CertificateRepository', () => {
    let repository;
    let mockBackendAPI;

    beforeEach(() => {
        mockBackendAPI = {
            store: {
                get: jest.fn(),
                set: jest.fn().mockResolvedValue()
            }
        };
        repository = new CertificateRepository(mockBackendAPI);
    });

    describe('getCertificates', () => {
        test('initializes with empty list when storage is empty', async () => {
            mockBackendAPI.store.get.mockResolvedValue(null);

            const result = await repository.getCertificates();

            expect(result).toEqual({ items: [] });
            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('clientCertificates', { items: [] });
        });

        test('initializes when items is not an array', async () => {
            mockBackendAPI.store.get.mockResolvedValue({ items: 'nope' });

            const result = await repository.getCertificates();

            expect(result).toEqual({ items: [] });
        });

        test('sanitizes entries and drops those without a host', async () => {
            mockBackendAPI.store.get.mockResolvedValue({
                items: [
                    { host: ' api.example.com ', certPath: ' /c.crt ', keyPath: '/c.key', caPath: '', enabled: false },
                    { host: '', certPath: '/orphan.crt' },
                    { certPath: '/no-host.crt' }
                ]
            });

            const result = await repository.getCertificates();

            expect(result.items).toEqual([
                { host: 'api.example.com', certPath: '/c.crt', keyPath: '/c.key', caPath: '', enabled: false }
            ]);
        });

        test('defaults enabled to true when omitted', async () => {
            mockBackendAPI.store.get.mockResolvedValue({
                items: [{ host: 'h', certPath: '', keyPath: '', caPath: '/ca.pem' }]
            });

            const result = await repository.getCertificates();

            expect(result.items[0].enabled).toBe(true);
        });
    });

    describe('saveCertificates', () => {
        test('rejects an invalid format', async () => {
            await expect(repository.saveCertificates(null)).rejects.toThrow('Invalid client certificate format');
        });

        test('persists sanitized entries', async () => {
            const result = await repository.saveCertificates({
                items: [{ host: 'h', certPath: '/c.crt', keyPath: '/c.key', caPath: '', enabled: true }]
            });

            expect(mockBackendAPI.store.set).toHaveBeenCalledWith('clientCertificates', {
                items: [{ host: 'h', certPath: '/c.crt', keyPath: '/c.key', caPath: '', enabled: true }]
            });
            expect(result.items).toHaveLength(1);
        });
    });
});
