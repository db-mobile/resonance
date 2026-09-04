/* global window */
import { CookieController } from '../../src/modules/controllers/CookieController.js';
import { CookieJarService } from '../../src/modules/services/CookieJarService.js';
import { CookieRepository } from '../../src/modules/storage/CookieRepository.js';

describe('CookieController.applyScriptCookieChanges', () => {
    let controller;
    let service;
    let storeData;

    beforeEach(async () => {
        storeData = {};
        window.backendAPI = {
            store: {
                get: jest.fn(async (key) => storeData[key]),
                set: jest.fn(async (key, value) => {
                    storeData[key] = value;
                })
            },
            settings: { get: jest.fn(async () => ({ cookieJarEnabled: true })) }
        };
        service = new CookieJarService(new CookieRepository(window.backendAPI));
        controller = new CookieController(service, { show: jest.fn() });
        controller.setActiveEnvironment('env-dev', 'Dev');
    });

    it('applies a set operation into the active environment', async () => {
        await controller.applyScriptCookieChanges([
            { op: 'set', cookie: { name: 'token', value: 'xyz', domain: 'api.example.com', path: '/' } }
        ]);

        const stored = await service.getAll('env-dev');
        expect(stored).toHaveLength(1);
        expect(stored[0].value).toBe('xyz');
        expect(stored[0].environmentId).toBe('env-dev');
    });

    it('a delete without a domain removes every cookie of that name', async () => {
        await service.putCookie({ name: 'session', value: 'a', domain: 'one.example.com' }, 'env-dev');
        await service.putCookie({ name: 'session', value: 'b', domain: 'two.example.com' }, 'env-dev');
        await service.putCookie({ name: 'keep', value: 'c', domain: 'one.example.com' }, 'env-dev');

        await controller.applyScriptCookieChanges([{ op: 'delete', name: 'session' }]);

        const stored = await service.getAll('env-dev');
        expect(stored.map((c) => c.name)).toEqual(['keep']);
    });

    it('a delete with a domain only removes that host cookie', async () => {
        await service.putCookie({ name: 'session', value: 'a', domain: 'one.example.com' }, 'env-dev');
        await service.putCookie({ name: 'session', value: 'b', domain: 'two.example.com' }, 'env-dev');

        await controller.applyScriptCookieChanges([
            { op: 'delete', name: 'session', domain: 'two.example.com' }
        ]);

        const stored = await service.getAll('env-dev');
        expect(stored).toHaveLength(1);
        expect(stored[0].domain).toBe('one.example.com');
    });

    it('clear empties only the active environment', async () => {
        await service.putCookie({ name: 'a', value: '1', domain: 'api.example.com' }, 'env-dev');
        await service.putCookie({ name: 'b', value: '2', domain: 'api.example.com' }, 'env-prod');

        await controller.applyScriptCookieChanges([{ op: 'clear' }]);

        expect(await service.getAll('env-dev')).toHaveLength(0);
        expect(await service.getAll('env-prod')).toHaveLength(1);
    });

    it('applies operations in the recorded order', async () => {
        await controller.applyScriptCookieChanges([
            { op: 'set', cookie: { name: 'a', value: '1', domain: 'api.example.com', path: '/' } },
            { op: 'clear' },
            { op: 'set', cookie: { name: 'b', value: '2', domain: 'api.example.com', path: '/' } }
        ]);

        const stored = await service.getAll('env-dev');
        expect(stored.map((c) => c.name)).toEqual(['b']);
    });

    it('script-set cookies are injected into a matching request', async () => {
        await controller.applyScriptCookieChanges([
            { op: 'set', cookie: { name: 'token', value: 'xyz', domain: 'api.example.com', path: '/' } }
        ]);

        expect(await controller.getCookieHeader('https://api.example.com/users')).toBe('token=xyz');
    });
});
