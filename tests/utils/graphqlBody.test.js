import { buildGraphQLBody } from '../../src/modules/utils/graphqlBody.js';

const identity = (text) => text;

describe('buildGraphQLBody', () => {
    test('trims and templates the query and variables and keeps a set operation name', () => {
        const process = (text) => text.replace('{{id}}', '7');

        const { body, error } = buildGraphQLBody({
            query: '  query Get($id: ID!) { user(id: $id) { name } }  ',
            variables: ' {"id": "{{id}}"} ',
            operationName: 'Get'
        }, process);

        expect(error).toBeUndefined();
        expect(body).toEqual({ query: 'query Get($id: ID!) { user(id: $id) { name } }', variables: { id: '7' }, operationName: 'Get' });
    });

    test('defaults missing fields and omits an empty operation name', () => {
        expect(buildGraphQLBody({}, identity)).toEqual({ body: { query: '', variables: {} } });
        expect(buildGraphQLBody({ query: 'q', operationName: null }, identity)).toEqual({ body: { query: 'q', variables: {} } });
    });

    test('reports unparseable variables instead of sending them', () => {
        const { body, error } = buildGraphQLBody({ query: 'q', variables: '{not json' }, identity);

        expect(body).toBeUndefined();
        expect(error).toBeInstanceOf(SyntaxError);
    });
});
