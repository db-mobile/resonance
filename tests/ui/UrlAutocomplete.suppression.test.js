/* global document */
import { UrlAutocomplete } from '../../src/modules/ui/UrlAutocomplete.js';

function make(entries) {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const controller = {
        handleHistorySelect: jest.fn(),
        service: { formatTimestamp: () => 'now', getMethodColor: () => 'red', searchHistory: jest.fn(async () => entries) }
    };
    const ac = new UrlAutocomplete(input, controller);
    ac.init();
    return { input, ac, controller };
}

describe('UrlAutocomplete while variable completion is open', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('does not show history suggestions and hides any that are visible', async () => {
        const entries = [{ request: { method: 'GET', rawUrl: 'http://a' }, timestamp: 1 }];
        const { input, ac, controller } = make(entries);
        await ac._showSuggestions('');
        expect(ac._isVisible()).toBe(true);

        input.dataset.varCompleting = 'true';
        await ac._showSuggestions('http');

        expect(ac._isVisible()).toBe(false);
        expect(controller.service.searchHistory).toHaveBeenCalledTimes(1);
    });

    test('hides immediately on the open event and cancels a pending debounce', async () => {
        const entries = [{ request: { method: 'GET', rawUrl: 'http://a' }, timestamp: 1 }];
        const { input, ac } = make(entries);
        await ac._showSuggestions('');
        const cancel = jest.spyOn(ac._debouncedShow, 'cancel');

        input.dispatchEvent(new CustomEvent('variable-autocomplete:open'));

        expect(ac._isVisible()).toBe(false);
        expect(cancel).toHaveBeenCalled();
    });
});
