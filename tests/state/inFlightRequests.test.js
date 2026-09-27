import { inFlightRequestFor, newRequestId, trackInFlight } from '../../src/modules/state/inFlightRequests.js';

describe('inFlightRequests', () => {
    test('tracks one id per tab and untracks only its own', () => {
        const untrackA = trackInFlight('tab-a', 'req-1');
        trackInFlight('tab-b', 'req-2');

        expect(inFlightRequestFor('tab-a')).toBe('req-1');
        expect(inFlightRequestFor('tab-b')).toBe('req-2');

        const untrackNewer = trackInFlight('tab-a', 'req-3');
        untrackA();
        expect(inFlightRequestFor('tab-a')).toBe('req-3');

        untrackNewer();
        expect(inFlightRequestFor('tab-a')).toBeNull();
    });

    test('a request without a tab is tracked under its own key', () => {
        const untrack = trackInFlight(null, 'req-x');
        expect(inFlightRequestFor(null)).toBe('req-x');
        untrack();
        expect(inFlightRequestFor(null)).toBeNull();
    });

    test('generates distinct ids', () => {
        expect(newRequestId()).not.toBe(newRequestId());
    });
});
