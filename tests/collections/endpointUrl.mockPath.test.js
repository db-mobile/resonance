import { buildMockPath, normalizeMockPath } from '../../src/modules/collections/endpointUrl.js';

describe('normalizeMockPath', () => {
    test.each([
        ['https://api.example.com/users/1?x=1', '/users/1'],
        ['http://localhost:8080', '/'],
        ['{{baseUrl}}/users', '/users'],
        ['{{baseUrl}}', '/'],
        ['users/{id}', '/users/{id}'],
        ['/users/{{userId}}', '/users/{{userId}}']
    ])('%s -> %s', (input, expected) => {
        expect(normalizeMockPath(input)).toBe(expected);
    });
});

describe('buildMockPath', () => {
    test('substitutes single- and double-brace path params', () => {
        expect(buildMockPath('/users/{id}/posts/{{postId}}', { id: '7', postId: '9' })).toBe('/users/7/posts/9');
    });

    test('strips the host from absolute cURL-imported paths', () => {
        expect(buildMockPath('https://api.example.com/login', {})).toBe('/login');
    });

    test('does not treat $ patterns in values specially', () => {
        expect(buildMockPath('/a/{id}', { id: '$&x' })).toBe('/a/$&x');
    });
});
