import { CookieJarService } from '../../src/modules/services/CookieJarService.js';
import { CookieRepository } from '../../src/modules/storage/CookieRepository.js';

describe('CookieJarService manual editing', () => {
    let service;
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
        service = new CookieJarService(new CookieRepository(mockBackendAPI));
    });

    test('putCookie adds a cookie with a canonical domain and composite id', async () => {
        const stored = await service.putCookie(
            { name: 'session', value: 'abc', domain: '.API.Example.com', path: '/v1' },
            'env-dev'
        );

        expect(stored.id).toBe('env-dev|api.example.com|/v1|session');
        expect(stored.domain).toBe('api.example.com');
        expect(stored.expires).toBeNull();
        expect(await service.getAll('env-dev')).toHaveLength(1);
    });

    test('putCookie edits a cookie in place when the key fields are unchanged', async () => {
        const original = await service.putCookie(
            { name: 'session', value: 'abc', domain: 'api.example.com', path: '/' },
            'env-dev'
        );
        await service.putCookie(
            { name: 'session', value: 'rotated', domain: 'api.example.com', path: '/' },
            'env-dev',
            original.id
        );

        const cookies = await service.getAll('env-dev');
        expect(cookies).toHaveLength(1);
        expect(cookies[0].value).toBe('rotated');
    });

    test('a rename removes the old entry and stores under the new id', async () => {
        const original = await service.putCookie(
            { name: 'session', value: 'abc', domain: 'api.example.com', path: '/' },
            'env-dev'
        );
        await service.putCookie(
            { name: 'token', value: 'abc', domain: 'api.example.com', path: '/' },
            'env-dev',
            original.id
        );

        const cookies = await service.getAll('env-dev');
        expect(cookies).toHaveLength(1);
        expect(cookies[0].name).toBe('token');
        expect(cookies[0].id).toBe('env-dev|api.example.com|/|token');
    });

    test('putCookie is scoped to its environment', async () => {
        await service.putCookie(
            { name: 'session', value: 'dev', domain: 'api.example.com' },
            'env-dev'
        );

        expect(await service.getAll('env-prod')).toHaveLength(0);
        expect(await service.getAll('env-dev')).toHaveLength(1);
    });

    test('string expires values are parsed to a timestamp', async () => {
        const future = new Date(Date.now() + 3600_000).toISOString();
        const stored = await service.putCookie(
            { name: 'session', value: 'abc', domain: 'api.example.com', expires: future },
            'env-dev'
        );

        expect(typeof stored.expires).toBe('number');
        expect(stored.expires).toBe(Date.parse(future));
    });

    test.each([
        [{ name: '', value: 'v', domain: 'a.com' }, 'name_required'],
        [{ name: 'a b', value: 'v', domain: 'a.com' }, 'name_invalid'],
        [{ name: 'n', value: 'v;w', domain: 'a.com' }, 'value_invalid'],
        [{ name: 'n', value: 'v', domain: '' }, 'domain_invalid'],
        [{ name: 'n', value: 'v', domain: 'not a domain' }, 'domain_invalid'],
        [{ name: 'n', value: 'v', domain: 'a.com', path: 'v1' }, 'path_invalid'],
        [{ name: 'n', value: 'v', domain: 'a.com', expires: 'not-a-date' }, 'expires_invalid']
    ])('putCookie rejects invalid input %#', async (cookie, errorCode) => {
        expect(service.validateCookie(cookie)).toBe(errorCode);
        await expect(service.putCookie(cookie, 'env-dev')).rejects.toThrow(errorCode);
        expect(await service.getAll('env-dev')).toHaveLength(0);
    });
});
