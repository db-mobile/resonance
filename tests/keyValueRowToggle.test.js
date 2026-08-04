/**
 * Query parameters and headers can be disabled without being deleted: a disabled
 * row stays in the table and in persistence, but is left out of the URL and the
 * request. Path params keep their plain, non-toggleable rows.
 */
jest.mock('../src/modules/state/currentEndpoint.js', () => ({
    getCurrentEndpoint: jest.fn(() => null),
    setCurrentEndpoint: jest.fn()
}));
jest.mock('../src/modules/appContext.js', () => ({ app: {} }));
jest.mock('../src/modules/ui/mirroredUrlSection.js', () => ({ notifyUrlUpdated: jest.fn() }));

const { normalizeKeyValueRows, activeKeyValueRows } = require('../src/modules/utils/keyValueRows.js');

const { document, window } = globalThis;

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
        loaded = {
            kv: require('../src/modules/keyValueManager.js'),
            app: require('../src/modules/appContext.js').app,
            currentEndpoint: require('../src/modules/state/currentEndpoint.js')
        };
    });
    return loaded;
}

function setRowEnabled(list, index, enabled) {
    const checkbox = list.children[index].querySelector('.row-enabled-checkbox');
    checkbox.checked = enabled;
    checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
}

describe('normalizeKeyValueRows', () => {
    test('keeps the enabled flag of persisted rows and defaults missing ones to enabled', () => {
        expect(normalizeKeyValueRows([
            { key: 'a', value: '1', enabled: false },
            { key: 'b', value: '2' }
        ])).toEqual([
            { key: 'a', value: '1', enabled: false },
            { key: 'b', value: '2', enabled: true }
        ]);
    });

    test('upgrades a legacy flat map into enabled rows', () => {
        expect(normalizeKeyValueRows({ page: '2' })).toEqual([
            { key: 'page', value: '2', enabled: true }
        ]);
    });

    test('treats missing data as no rows', () => {
        expect(normalizeKeyValueRows(null)).toEqual([]);
        expect(normalizeKeyValueRows(undefined)).toEqual([]);
    });
});

describe('activeKeyValueRows', () => {
    test('drops disabled and keyless rows', () => {
        expect(activeKeyValueRows([
            { key: 'a', value: '1' },
            { key: 'b', value: '2', enabled: false },
            { key: '', value: '3' }
        ])).toEqual([{ key: 'a', value: '1', enabled: true }]);
    });
});

describe('query param rows', () => {
    test('only lists that opt in get an enabled checkbox', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');
        const headersList = document.getElementById('headers-list');
        const pathParamsList = document.getElementById('path-params-list');

        kv.addKeyValueRow(queryParamsList, 'page', '2');
        kv.addKeyValueRow(headersList, 'Accept', 'application/json');
        kv.addKeyValueRow(pathParamsList, 'id', '7');

        expect(queryParamsList.querySelector('.row-enabled-checkbox')).not.toBeNull();
        expect(headersList.querySelector('.row-enabled-checkbox')).not.toBeNull();
        expect(pathParamsList.querySelector('.row-enabled-checkbox')).toBeNull();
    });

    test('a new row starts enabled', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');

        kv.addKeyValueRow(queryParamsList, 'page', '2');

        expect(queryParamsList.querySelector('.row-enabled-checkbox').checked).toBe(true);
        expect(kv.parseKeyValuePairs(queryParamsList)).toEqual({ page: '2' });
    });

    test('a disabled row is left out of the request but kept in the row list', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');

        kv.addKeyValueRow(queryParamsList, 'page', '2');
        kv.addKeyValueRow(queryParamsList, 'debug', 'true', false);

        expect(kv.parseKeyValuePairs(queryParamsList)).toEqual({ page: '2' });
        expect(kv.parseKeyValueRows(queryParamsList)).toEqual([
            { key: 'page', value: '2', enabled: true },
            { key: 'debug', value: 'true', enabled: false }
        ]);
    });

    test('populating from persisted rows restores the disabled state', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');

        kv.populateKeyValueList(queryParamsList, [
            { key: 'page', value: '2', enabled: true },
            { key: 'debug', value: 'true', enabled: false }
        ]);

        const checkboxes = queryParamsList.querySelectorAll('.row-enabled-checkbox');
        expect([...checkboxes].map(box => box.checked)).toEqual([true, false]);
    });
});

describe('query params and the URL', () => {
    test('disabled params are dropped from the URL', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');
        const urlInput = document.getElementById('url-input');

        urlInput.value = 'https://example.com/api';
        kv.addKeyValueRow(queryParamsList, 'page', '2');
        kv.addKeyValueRow(queryParamsList, 'debug', 'true', false);
        kv.updateUrlFromQueryParams();

        expect(urlInput.value).toBe('https://example.com/api?page=2');
    });

    test('a disabled row survives rebuilding the table from the URL', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');
        const urlInput = document.getElementById('url-input');

        kv.addKeyValueRow(queryParamsList, 'debug', 'true', false);
        kv.addKeyValueRow(queryParamsList, 'page', '2');

        urlInput.value = 'https://example.com/api?page=3';
        kv.updateQueryParamsFromUrl();

        expect(kv.parseKeyValueRows(queryParamsList)).toEqual([
            { key: 'debug', value: 'true', enabled: false },
            { key: 'page', value: '3', enabled: true }
        ]);
    });

    test('clearing the URL keeps disabled rows instead of wiping the table', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');
        const urlInput = document.getElementById('url-input');

        kv.addKeyValueRow(queryParamsList, 'debug', 'true', false);

        urlInput.value = '';
        kv.updateQueryParamsFromUrl();

        expect(kv.parseKeyValueRows(queryParamsList)).toEqual([
            { key: 'debug', value: 'true', enabled: false }
        ]);
    });

    test('toggling a checkbox rewrites the URL both ways', () => {
        const { kv } = loadKeyValueManager();
        const queryParamsList = document.getElementById('query-params-list');
        const urlInput = document.getElementById('url-input');

        kv.initKeyValueListeners();
        urlInput.value = 'https://example.com/api';
        kv.addKeyValueRow(queryParamsList, 'page', '2');
        kv.addKeyValueRow(queryParamsList, 'debug', 'true');
        kv.updateUrlFromQueryParams();

        setRowEnabled(queryParamsList, 1, false);
        expect(urlInput.value).toBe('https://example.com/api?page=2');
        expect(queryParamsList.children[1].classList.contains('row-disabled')).toBe(true);

        setRowEnabled(queryParamsList, 1, true);
        expect(urlInput.value).toBe('https://example.com/api?page=2&debug=true');
        expect(queryParamsList.children[1].classList.contains('row-disabled')).toBe(false);
    });
});

describe('request headers', () => {
    test('a disabled header is left out of the request but kept in the row list', () => {
        const { kv } = loadKeyValueManager();
        const headersList = document.getElementById('headers-list');

        kv.addKeyValueRow(headersList, 'Content-Type', 'application/json');
        kv.addKeyValueRow(headersList, 'X-Debug', 'on', false);

        expect(kv.parseKeyValuePairs(headersList)).toEqual({ 'Content-Type': 'application/json' });
        expect(kv.parseKeyValueRows(headersList)).toEqual([
            { key: 'Content-Type', value: 'application/json', enabled: true },
            { key: 'X-Debug', value: 'on', enabled: false }
        ]);
    });

    test('populating from persisted headers restores the disabled state', () => {
        const { kv } = loadKeyValueManager();
        const headersList = document.getElementById('headers-list');

        kv.populateKeyValueList(headersList, [
            { key: 'Accept', value: '*/*', enabled: true },
            { key: 'X-Debug', value: 'on', enabled: false }
        ]);

        const checkboxes = headersList.querySelectorAll('.row-enabled-checkbox');
        expect([...checkboxes].map(box => box.checked)).toEqual([true, false]);
    });

    test('unchecking a header dims the row and autosaves it as disabled', () => {
        jest.useFakeTimers();
        try {
            const { kv, app, currentEndpoint } = loadKeyValueManager();
            const headersList = document.getElementById('headers-list');
            const saveCurrentHeaders = jest.fn();

            currentEndpoint.getCurrentEndpoint.mockReturnValue({ collectionId: 'c1', endpointId: 'e1' });
            app.collectionService = { saveCurrentHeaders };
            kv.initKeyValueListeners();

            kv.addKeyValueRow(headersList, 'X-Debug', 'on');
            setRowEnabled(headersList, 0, false);
            jest.advanceTimersByTime(500);

            expect(headersList.children[0].classList.contains('row-disabled')).toBe(true);
            expect(saveCurrentHeaders).toHaveBeenCalledWith('c1', 'e1', { headersList });
            expect(kv.parseKeyValueRows(headersList)).toEqual([
                { key: 'X-Debug', value: 'on', enabled: false }
            ]);
        } finally {
            jest.useRealTimers();
        }
    });
});
