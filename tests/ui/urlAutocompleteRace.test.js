/* global document */
import { UrlAutocomplete } from '../../src/modules/ui/UrlAutocomplete.js';
import { HistoryRenderer } from '../../src/modules/ui/HistoryRenderer.js';

jest.mock('../../src/modules/ui/ConfirmDialog.js', () => ({
    ConfirmDialog: jest.fn().mockImplementation(() => ({ show: jest.fn() }))
}));
jest.mock('../../src/modules/services/HistoryService.js', () => ({
    HistoryService: jest.fn().mockImplementation(() => ({
        repository: {},
        searchHistory: jest.fn(),
        getAllHistory: jest.fn()
    }))
}));

const entry = (url) => ({ id: url, request: { rawUrl: url, method: 'GET' } });

describe('UrlAutocomplete out-of-order responses', () => {
    let autocomplete;
    let searchHistory;

    beforeEach(() => {
        document.body.innerHTML = '<div><input id="race-url-input"></div>';
        searchHistory = jest.fn();
        autocomplete = new UrlAutocomplete(document.getElementById('race-url-input'), {
            service: { searchHistory, formatTimestamp: () => 'now', getMethodColor: () => '#000' }
        });
        autocomplete.init();
    });

    test('a slow earlier search cannot clobber a newer result', async () => {
        let resolveFirst;
        searchHistory
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce([entry('https://newer.example')]);

        const first = autocomplete._showSuggestions('a');
        const second = autocomplete._showSuggestions('ab');
        await second;

        resolveFirst([entry('https://stale.example')]);
        await first;

        expect(autocomplete.suggestions.map(s => s.request.rawUrl)).toEqual(['https://newer.example']);
    });
});

describe('HistoryRenderer out-of-order searches', () => {
    test('stale results are discarded and historyItems tracks the latest', async () => {
        document.body.innerHTML = `
            <div id="history-list"></div>
            <input id="history-search-input">
            <button id="clear-all-history-btn"></button>
        `;
        const renderer = new HistoryRenderer({}, jest.fn());
        renderer.renderHistoryList = jest.fn();

        let resolveFirst;
        renderer.service.searchHistory
            .mockImplementationOnce(() => new Promise((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce([entry('https://newer.example')]);

        const first = renderer.handleSearch('a');
        const second = renderer.handleSearch('ab');
        await second;

        resolveFirst([entry('https://stale.example')]);
        await first;

        expect(renderer.renderHistoryList).toHaveBeenCalledTimes(1);
        expect(renderer.historyItems.map(e => e.request.rawUrl)).toEqual(['https://newer.example']);
    });
});
