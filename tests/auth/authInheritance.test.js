import { resolveEffectiveAuthConfig } from '../../src/modules/auth/authInheritance.js';

describe('resolveEffectiveAuthConfig', () => {
    const repositoryWith = (inheritedAuth) => ({
        getInheritedAuthConfig: jest.fn(async () => inheritedAuth)
    });

    test('null auth config resolves to none', async () => {
        const resolved = await resolveEffectiveAuthConfig(null, {
            collectionId: 'c1',
            repository: repositoryWith(null)
        });
        expect(resolved.type).toBe('none');
    });

    test('non-inherit configs pass through untouched', async () => {
        const endpointAuth = { type: 'bearer', config: { token: 'abc' } };
        const repository = repositoryWith({ type: 'basic', config: { username: 'u' } });

        const resolved = await resolveEffectiveAuthConfig(endpointAuth, {
            collectionId: 'c1',
            endpointId: 'e1',
            repository
        });

        expect(resolved).toBe(endpointAuth);
        expect(repository.getInheritedAuthConfig).not.toHaveBeenCalled();
    });

    test('explicit none stays none even when inherited auth exists', async () => {
        const resolved = await resolveEffectiveAuthConfig({ type: 'none', config: {} }, {
            collectionId: 'c1',
            repository: repositoryWith({ type: 'bearer', config: { token: 'abc' } })
        });
        expect(resolved.type).toBe('none');
    });

    test('inherit resolves through the repository chain with the endpoint id', async () => {
        const inherited = { type: 'bearer', config: { token: 'shared' } };
        const repository = repositoryWith(inherited);

        const resolved = await resolveEffectiveAuthConfig({ type: 'inherit', config: {} }, {
            collectionId: 'c1',
            endpointId: 'e1',
            repository
        });

        expect(resolved).toBe(inherited);
        expect(repository.getInheritedAuthConfig).toHaveBeenCalledWith('c1', 'e1');
    });

    test('inherit with inherited auth of type none resolves to none', async () => {
        const resolved = await resolveEffectiveAuthConfig({ type: 'inherit', config: {} }, {
            collectionId: 'c1',
            repository: repositoryWith({ type: 'none', config: {} })
        });
        expect(resolved.type).toBe('none');
    });

    test('inherit when nothing is configured resolves to none', async () => {
        const resolved = await resolveEffectiveAuthConfig({ type: 'inherit', config: {} }, {
            collectionId: 'c1',
            repository: repositoryWith(null)
        });
        expect(resolved.type).toBe('none');
    });

    test('inherit without a collection id resolves to none', async () => {
        const repository = repositoryWith({ type: 'bearer', config: { token: 'x' } });
        const resolved = await resolveEffectiveAuthConfig({ type: 'inherit', config: {} }, {
            collectionId: null,
            repository
        });
        expect(resolved.type).toBe('none');
        expect(repository.getInheritedAuthConfig).not.toHaveBeenCalled();
    });

    test('inherit without a repository resolves to none', async () => {
        const resolved = await resolveEffectiveAuthConfig({ type: 'inherit', config: {} }, {
            collectionId: 'c1',
            repository: null
        });
        expect(resolved.type).toBe('none');
    });

    test('an inherited auth of type inherit is not followed further', async () => {
        const resolved = await resolveEffectiveAuthConfig({ type: 'inherit', config: {} }, {
            collectionId: 'c1',
            repository: repositoryWith({ type: 'inherit', config: {} })
        });
        expect(resolved.type).toBe('none');
    });
});
