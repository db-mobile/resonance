import { describe, it, expect } from '@jest/globals';
import {
    normalizeSubscriptionUrl,
    buildConnectionInit,
    buildSubscribe,
    buildComplete,
    buildPong,
    selectActiveOperationType
} from '../../src/modules/graphqlTransportWs.js';

describe('normalizeSubscriptionUrl', () => {
    it('swaps http(s) to ws(s)', () => {
        expect(normalizeSubscriptionUrl('http://x/graphql')).toBe('ws://x/graphql');
        expect(normalizeSubscriptionUrl('https://x/graphql')).toBe('wss://x/graphql');
    });

    it('leaves ws(s) URLs untouched', () => {
        expect(normalizeSubscriptionUrl('ws://x')).toBe('ws://x');
        expect(normalizeSubscriptionUrl('wss://x')).toBe('wss://x');
    });

    it('defaults scheme-less input to ws://', () => {
        expect(normalizeSubscriptionUrl('x/graphql')).toBe('ws://x/graphql');
    });

    it('returns empty string for falsy input', () => {
        expect(normalizeSubscriptionUrl('')).toBe('');
        expect(normalizeSubscriptionUrl(undefined)).toBe('');
    });
});

describe('graphql-transport-ws message builders', () => {
    it('builds connection_init without payload by default', () => {
        expect(buildConnectionInit()).toEqual({ type: 'connection_init' });
        expect(buildConnectionInit({})).toEqual({ type: 'connection_init' });
    });

    it('attaches a non-empty connection_init payload', () => {
        expect(buildConnectionInit({ authToken: 'abc' })).toEqual({
            type: 'connection_init',
            payload: { authToken: 'abc' }
        });
    });

    it('builds a subscribe frame omitting empty variables/operationName', () => {
        expect(buildSubscribe('1', { query: 'subscription { t }', variables: {}, operationName: null }))
            .toEqual({ id: '1', type: 'subscribe', payload: { query: 'subscription { t }' } });
    });

    it('includes variables and operationName when present', () => {
        expect(buildSubscribe('1', {
            query: 'subscription S($id: ID!) { t(id: $id) }',
            variables: { id: '5' },
            operationName: 'S'
        })).toEqual({
            id: '1',
            type: 'subscribe',
            payload: {
                query: 'subscription S($id: ID!) { t(id: $id) }',
                variables: { id: '5' },
                operationName: 'S'
            }
        });
    });

    it('builds complete and pong frames', () => {
        expect(buildComplete('1')).toEqual({ id: '1', type: 'complete' });
        expect(buildPong()).toEqual({ type: 'pong' });
    });
});

describe('selectActiveOperationType', () => {
    it('returns null when there are no operations', () => {
        expect(selectActiveOperationType([], 'x')).toBeNull();
        expect(selectActiveOperationType(null, 'x')).toBeNull();
    });

    it('uses the single operation type when nothing is selected', () => {
        expect(selectActiveOperationType([{ name: null, type: 'subscription' }], null))
            .toBe('subscription');
    });

    it('honours the selected operation name', () => {
        const ops = [
            { name: 'GetUser', type: 'query' },
            { name: 'OnUser', type: 'subscription' }
        ];
        expect(selectActiveOperationType(ops, 'OnUser')).toBe('subscription');
        expect(selectActiveOperationType(ops, 'GetUser')).toBe('query');
    });

    it('falls back to the first named operation when the selection is missing', () => {
        const ops = [
            { name: 'A', type: 'mutation' },
            { name: 'B', type: 'query' }
        ];
        expect(selectActiveOperationType(ops, 'Nonexistent')).toBe('mutation');
    });

    it('falls back to the first operation when none are named', () => {
        expect(selectActiveOperationType([{ name: null, type: 'query' }], null)).toBe('query');
    });
});
