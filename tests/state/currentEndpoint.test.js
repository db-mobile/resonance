import { getCurrentEndpoint, setCurrentEndpoint, onCurrentEndpointChange } from '../../src/modules/state/currentEndpoint.js';

describe('currentEndpoint', () => {
    afterEach(() => {
        setCurrentEndpoint(null);
    });

    test('stores and returns the endpoint reference', () => {
        const ref = { collectionId: 'c1', endpointId: 'e1' };
        setCurrentEndpoint(ref);
        expect(getCurrentEndpoint()).toBe(ref);
    });

    test('notifies listeners on every set, including same value and null', () => {
        const seen = [];
        const unsubscribe = onCurrentEndpointChange((value) => seen.push(value));
        const ref = { collectionId: 'c1', endpointId: 'e1' };

        setCurrentEndpoint(ref);
        setCurrentEndpoint(ref);
        setCurrentEndpoint(null);

        expect(seen).toEqual([ref, ref, null]);
        unsubscribe();
        setCurrentEndpoint(ref);
        expect(seen).toHaveLength(3);
    });

    test('a throwing listener does not block the others', () => {
        const seen = [];
        const stopThrowing = onCurrentEndpointChange(() => { throw new Error('boom'); });
        const stopSeeing = onCurrentEndpointChange((value) => seen.push(value));

        setCurrentEndpoint({ collectionId: 'c', endpointId: 'e' });

        expect(seen).toHaveLength(1);
        stopThrowing();
        stopSeeing();
    });
});
