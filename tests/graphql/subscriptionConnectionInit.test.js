import { connectionInitPayload } from '../../src/modules/graphqlSubscriptionHandler.js';
import { buildConnectionInit } from '../../src/modules/graphqlTransportWs.js';

describe('connection_init payload', () => {
    test('carries the request headers, with Authorization also at the top level', () => {
        const payload = connectionInitPayload({ authorization: 'Bearer t', 'x-hasura-role': 'user' });

        expect(payload).toEqual({
            headers: { authorization: 'Bearer t', 'x-hasura-role': 'user' },
            Authorization: 'Bearer t'
        });
        expect(buildConnectionInit(payload)).toEqual({ type: 'connection_init', payload });
    });

    test('is omitted when there are no headers', () => {
        expect(buildConnectionInit(connectionInitPayload({}))).toEqual({ type: 'connection_init' });
    });
});
