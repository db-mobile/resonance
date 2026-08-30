/**
 * Duplicate query keys are legal (`?tag=a&tag=b`) and must survive the
 * URL ↔ table round trip, and a literal `%` in the URL must not destroy
 * the parameter rows mid-rebuild.
 */
jest.mock('../src/modules/state/currentEndpoint.js', () => ({
    getCurrentEndpoint: jest.fn(() => null),
    setCurrentEndpoint: jest.fn()
}));
jest.mock('../src/modules/appContext.js', () => ({ app: {} }));
jest.mock('../src/modules/ui/mirroredUrlSection.js', () => ({ notifyUrlUpdated: jest.fn() }));

const { document } = globalThis;

const DOM = `
    <input id="url-input" />
    <div id="path-params-list"></div>
    <button id="add-path-param-btn"></button>
    <div id="headers-list" data-toggleable-rows="true"></div>
    <button id="add-header-btn"></button>
    <div id="query-params-list" data-toggleable-rows="true"></div>
    <button id="add-query-param-btn"></button>
`;

function loadKeyValueManager() {
    document.body.innerHTML = DOM;
    let loaded;
    jest.isolateModules(() => {
        loaded = { kv: require('../src/modules/keyValueManager.js') };
    });
    return loaded;
}

const rowValues = (list) => Array.from(list.querySelectorAll('.key-value-row')).map((row) => ({
    key: row.querySelector('.key-input').value,
    value: row.querySelector('.value-input').value
}));

describe('duplicate query keys', () => {
    test('a URL with duplicate keys produces one row per pair', () => {
        const { kv } = loadKeyValueManager();
        const urlInput = document.getElementById('url-input');
        urlInput.value = 'https://api.test/items?id=1&id=2&id=3';

        kv.updateQueryParamsFromUrl();

        expect(rowValues(document.getElementById('query-params-list'))).toEqual([
            { key: 'id', value: '1' },
            { key: 'id', value: '2' },
            { key: 'id', value: '3' }
        ]);
    });

    test('rebuilding the URL from rows keeps every duplicate pair', () => {
        const { kv } = loadKeyValueManager();
        const urlInput = document.getElementById('url-input');
        const queryParamsList = document.getElementById('query-params-list');
        urlInput.value = 'https://api.test/items';
        kv.addKeyValueRow(queryParamsList, 'id', '1');
        kv.addKeyValueRow(queryParamsList, 'id', '2');

        kv.updateUrlFromQueryParams();

        expect(urlInput.value).toBe('https://api.test/items?id=1&id=2');
    });
});

describe('literal % in the URL', () => {
    test('rows survive with the raw text instead of being wiped', () => {
        const { kv } = loadKeyValueManager();
        const urlInput = document.getElementById('url-input');
        urlInput.value = 'https://api.test/items?d=100%&page=2';

        kv.updateQueryParamsFromUrl();

        expect(rowValues(document.getElementById('query-params-list'))).toEqual([
            { key: 'd', value: '100%' },
            { key: 'page', value: '2' }
        ]);
    });
});
