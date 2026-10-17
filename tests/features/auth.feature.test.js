/* global document */

async function load() {
    jest.resetModules();
    document.body.innerHTML = '<select id="auth-type-select"></select><div id="auth-fields-container"></div>';
    const getElementById = jest.spyOn(document, 'getElementById');
    const module = await import('../../src/modules/authManager.js');
    const lookupsDuringImport = getElementById.mock.calls.length;
    getElementById.mockRestore();
    const { authFeature } = await import('../../src/modules/auth.feature.js');
    return { module, authFeature, lookupsDuringImport };
}

function makeContext() {
    const shared = new Map();
    return { backendAPI: {}, statusDisplay: { update() {} }, secretStore: null, toast: {}, _shared: shared, provide: (n, v) => shared.set(n, v) && v, get: (n) => shared.get(n) };
}

describe('auth feature', () => {
    test('the auth manager module no longer builds a singleton at import time', async () => {
        const { module, lookupsDuringImport } = await load();

        expect(module.authManager).toBeUndefined();
        expect(lookupsDuringImport).toBe(0);
    });

    test('creates the manager bound to the request form and exposes it on app and the bus', async () => {
        const { authFeature } = await load();
        const { manager } = authFeature.create(makeContext());

        expect(manager.authTypeSelect).toBe(document.getElementById('auth-type-select'));
        expect(manager.authFieldsContainer).toBe(document.getElementById('auth-fields-container'));
        expect(authFeature.globals).toEqual({ authManager: 'manager' });
        expect(authFeature.provides).toEqual({ authManager: 'manager' });
    });

    test('resolves the collection controller lazily for inherited-auth lookups and the edit button', async () => {
        const { authFeature } = await load();
        const ctx = makeContext();
        const { manager } = authFeature.create(ctx);

        expect(manager.getInheritedAuthInfo()).toBeNull();

        const collectionController = {
            describeInheritedAuth: jest.fn(async () => ({ collectionId: 'c1', collectionName: 'Shop', folderId: null, folderName: '', authType: 'bearer' })),
            openAuthEditor: jest.fn()
        };
        ctx.provide('collectionController', collectionController);

        await expect(manager.getInheritedAuthInfo()).resolves.toMatchObject({ authType: 'bearer' });
        manager.onOpenCollectionAuth('c1', null);
        expect(collectionController.openAuthEditor).toHaveBeenCalledWith('c1', null);
    });
});
