import { extractResponseSchema } from '../../src/modules/controllers/MockServerController.js';

const response = (mediaType, schema) => ({ content: { [mediaType]: { schema } } });

describe('extractResponseSchema', () => {
    test.each(['application/json', 'application/vnd.api+json', 'application/json; charset=utf-8', 'Application/Problem+JSON'])(
        'reads the schema of %s',
        (mediaType) => {
            expect(extractResponseSchema({ method: 'GET', responses: { 200: response(mediaType, { type: 'object' }) } }))
                .toEqual({ type: 'object' });
        }
    );

    test('prefers plain JSON over a variant in the same response', () => {
        const responses = { 200: { content: {
            'application/hal+json': { schema: { title: 'hal' } },
            'application/json': { schema: { title: 'plain' } }
        } } };
        expect(extractResponseSchema({ method: 'GET', responses })).toEqual({ title: 'plain' });
    });

    test('prefers 200, then 201 for POST and PUT, then any other success', () => {
        const responses = { 201: response('application/json', { title: 'created' }), 202: response('application/json', { title: 'accepted' }) };
        expect(extractResponseSchema({ method: 'POST', responses })).toEqual({ title: 'created' });
        expect(extractResponseSchema({ method: 'GET', responses: { 404: response('application/json', {}), 202: responses[202] } }))
            .toEqual({ title: 'accepted' });
    });

    test('returns null without a JSON schema', () => {
        expect(extractResponseSchema({ method: 'GET' })).toBeNull();
        expect(extractResponseSchema({ method: 'GET', responses: { 200: response('text/plain', { type: 'string' }) } })).toBeNull();
        expect(extractResponseSchema({ method: 'GET', responses: { 404: response('application/json', {}) } })).toBeNull();
    });
});
