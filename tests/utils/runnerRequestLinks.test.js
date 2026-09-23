import { resolveRequestLinks } from '../../src/modules/utils/runnerRequestLinks.js';

describe('resolveRequestLinks', () => {
    const collections = [{
        id: 'c-new',
        endpoints: [
            { id: 'e-albums', name: 'Get all albums', method: 'GET', path: '/albums' },
            { id: 'e-comment', name: 'Get comment by ID', method: 'GET', path: '/comments/{id}' }
        ]
    }];

    test('leaves requests that still resolve untouched', () => {
        const request = { collectionId: 'c-new', endpointId: 'e-albums', name: 'Get all albums', method: 'GET', path: '/albums' };

        const result = resolveRequestLinks([request], collections);

        expect(result.requests[0]).toBe(request);
        expect(result.relinked).toBe(0);
        expect(result.missing.size).toBe(0);
    });

    test('treats {{param}} and {param} path templates as the same path', () => {
        const request = { collectionId: 'c-old', endpointId: 'e-old', name: 'Get comment by ID', method: 'GET', path: '/comments/{{id}}' };

        const result = resolveRequestLinks([request], collections);

        expect(result.requests[0]).toMatchObject({ collectionId: 'c-new', endpointId: 'e-comment' });
        expect(result.relinked).toBe(1);
    });

    test('marks a request missing when nothing matches', () => {
        const request = { collectionId: 'c-old', endpointId: 'e-old', name: 'Gone', method: 'GET', path: '/gone' };

        expect([...resolveRequestLinks([request], collections).missing]).toEqual([0]);
    });
});
