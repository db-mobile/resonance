import {
    endpointDefaults,
    effectiveOverrides,
    stripUnchangedOverrides
} from '../../src/modules/utils/requestOverrides.js';

describe('requestOverrides', () => {
    const defaults = endpointDefaults({
        pathParams: [{ key: 'id', value: '1' }],
        queryParams: [{ key: 'page', value: '1' }, { key: 'off', value: 'x', enabled: false }],
        headers: [{ key: 'X-A', value: 'a' }],
        body: '{"a":1}'
    });

    test('endpointDefaults drops disabled rows and normalises missing values', () => {
        expect(defaults).toEqual({
            pathParams: [{ key: 'id', value: '1' }],
            queryParams: [{ key: 'page', value: '1' }],
            headers: [{ key: 'X-A', value: 'a' }],
            body: '{"a":1}'
        });
        expect(endpointDefaults(null)).toEqual({ pathParams: [], queryParams: [], headers: [], body: '' });
    });

    test('effectiveOverrides shows live endpoint values for fields the user never touched', () => {
        const effective = effectiveOverrides({ headers: [{ key: 'X-B', value: 'b' }] }, defaults);

        expect(effective.headers).toEqual([{ key: 'X-B', value: 'b' }]);
        expect(effective.queryParams).toEqual(defaults.queryParams);
        expect(effective.body).toBe(defaults.body);
    });

    test('stripUnchangedOverrides keeps only fields that differ from the endpoint', () => {
        const stripped = stripUnchangedOverrides({
            pathParams: [{ key: 'id', value: '1' }],
            queryParams: [{ key: 'page', value: '2' }],
            headers: [{ key: 'X-A', value: 'a' }],
            body: ' {"a":1} '
        }, defaults);

        expect(stripped).toEqual({ queryParams: [{ key: 'page', value: '2' }] });
    });

    test('an explicitly cleared field stays an override', () => {
        expect(stripUnchangedOverrides({ headers: [], body: '' }, defaults)).toEqual({ headers: [], body: '' });
    });
});
