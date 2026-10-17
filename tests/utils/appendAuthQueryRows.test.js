import { appendAuthQueryRows } from '../../src/modules/utils/keyValueRows.js';

describe('appendAuthQueryRows', () => {
    test('appends auth query params as enabled rows after the existing ones', () => {
        const rows = [{ key: 'page', value: '1', enabled: true }];

        appendAuthQueryRows(rows, { api_key: 'k', sig: 's' });

        expect(rows).toEqual([
            { key: 'page', value: '1', enabled: true },
            { key: 'api_key', value: 'k', enabled: true },
            { key: 'sig', value: 's', enabled: true }
        ]);
    });

    test('never overrides a row the user already has and tolerates a missing map', () => {
        const rows = [{ key: 'api_key', value: 'mine' }];

        appendAuthQueryRows(rows, { api_key: 'theirs' });
        appendAuthQueryRows(rows, null);

        expect(rows).toEqual([{ key: 'api_key', value: 'mine' }]);
    });
});
