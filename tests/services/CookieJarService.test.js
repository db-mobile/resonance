import { CookieJarService } from '../../src/modules/services/CookieJarService.js';
import { CookieRepository } from '../../src/modules/storage/CookieRepository.js';

describe('CookieJarService environment isolation', () => {
    let service;
    let repository;
    let storeData;

    beforeEach(() => {
        storeData = {};
        const mockBackendAPI = {
            store: {
                get: jest.fn(async (key) => storeData[key]),
                set: jest.fn(async (key, value) => {
                    storeData[key] = value;
                })
            }
        };
        repository = new CookieRepository(mockBackendAPI);
        service = new CookieJarService(repository);
    });

    test('same cookie in two environments is stored separately', async () => {
        await service.processCookiesFromResponse(
            ['session=devToken; Path=/'],
            'https://api.example.com/login',
            'env-dev'
        );
        await service.processCookiesFromResponse(
            ['session=prodToken; Path=/'],
            'https://api.example.com/login',
            'env-prod'
        );

        const devHeader = await service.getCookieHeaderForRequest('https://api.example.com/', 'env-dev');
        const prodHeader = await service.getCookieHeaderForRequest('https://api.example.com/', 'env-prod');

        expect(devHeader).toBe('session=devToken');
        expect(prodHeader).toBe('session=prodToken');
    });

    test('updating a cookie only affects its own environment', async () => {
        await service.processCookiesFromResponse(
            ['session=devToken; Path=/'],
            'https://api.example.com/login',
            'env-dev'
        );
        await service.processCookiesFromResponse(
            ['session=rotatedDevToken; Path=/'],
            'https://api.example.com/login',
            'env-dev'
        );

        const devCookies = await service.getAll('env-dev');

        expect(devCookies).toHaveLength(1);
        expect(devCookies[0].value).toBe('rotatedDevToken');
    });

    test('expiring a cookie in one environment keeps the sibling environment cookie', async () => {
        await service.processCookiesFromResponse(
            ['session=devToken; Path=/'],
            'https://api.example.com/login',
            'env-dev'
        );
        await service.processCookiesFromResponse(
            ['session=prodToken; Path=/'],
            'https://api.example.com/login',
            'env-prod'
        );
        await service.processCookiesFromResponse(
            ['session=gone; Path=/; Max-Age=0'],
            'https://api.example.com/logout',
            'env-dev'
        );

        expect(await service.getCookieHeaderForRequest('https://api.example.com/', 'env-dev')).toBeNull();
        expect(await service.getCookieHeaderForRequest('https://api.example.com/', 'env-prod')).toBe('session=prodToken');
    });
});

describe('CookieRepository legacy id migration', () => {
    let repository;
    let storeData;
    let mockBackendAPI;

    const legacyCookie = {
        id: 'api.example.com|/|session',
        environmentId: 'env-dev',
        name: 'session',
        value: 'legacyToken',
        domain: 'api.example.com',
        path: '/',
        expires: null,
        httpOnly: false,
        secure: false,
        sameSite: null,
        hostOnly: true,
        createdAt: 1000,
        updatedAt: 1000
    };

    beforeEach(() => {
        storeData = {};
        mockBackendAPI = {
            store: {
                get: jest.fn(async (key) => storeData[key]),
                set: jest.fn(async (key, value) => {
                    storeData[key] = value;
                })
            }
        };
        repository = new CookieRepository(mockBackendAPI);
    });

    test('rewrites legacy ids to the environment-scoped format and persists', async () => {
        storeData.cookieJar = [legacyCookie];

        const cookies = await repository.getAll('env-dev');

        expect(cookies).toHaveLength(1);
        expect(cookies[0].id).toBe('env-dev|api.example.com|/|session');
        expect(storeData.cookieJar[0].id).toBe('env-dev|api.example.com|/|session');
    });

    test('assigns default environment to cookies without one', async () => {
        storeData.cookieJar = [{ ...legacyCookie, environmentId: undefined }];

        const cookies = await repository.getAll('default');

        expect(cookies).toHaveLength(1);
        expect(cookies[0].id).toBe('default|api.example.com|/|session');
        expect(cookies[0].environmentId).toBe('default');
    });

    test('deduplicates colliding entries keeping the most recently updated', async () => {
        storeData.cookieJar = [
            { ...legacyCookie, value: 'older', updatedAt: 1000 },
            { ...legacyCookie, value: 'newer', updatedAt: 2000 }
        ];

        const cookies = await repository.getAll('env-dev');

        expect(cookies).toHaveLength(1);
        expect(cookies[0].value).toBe('newer');
    });

    test('leaves already-migrated data untouched without rewriting the store', async () => {
        storeData.cookieJar = [
            { ...legacyCookie, id: 'env-dev|api.example.com|/|session' }
        ];

        await repository.getAll('env-dev');

        expect(mockBackendAPI.store.set).not.toHaveBeenCalled();
    });
});
