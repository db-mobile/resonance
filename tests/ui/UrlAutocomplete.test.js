/* global document, window */
import { UrlAutocomplete } from '../../src/modules/ui/UrlAutocomplete.js';

function makeAutocomplete() {
    const container = document.createElement('div');
    const input = document.createElement('input');
    container.appendChild(input);
    document.body.appendChild(container);

    const historyController = {
        handleHistorySelect: jest.fn(),
        service: {
            formatTimestamp: () => 'Just now',
            getMethodColor: () => 'rgb(1, 2, 3)',
            searchHistory: async () => []
        }
    };

    const ac = new UrlAutocomplete(input, historyController);
    ac.init();
    return ac;
}

describe('UrlAutocomplete rendering', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renders an attacker-controlled URL as inert text, not markup', () => {
        const ac = makeAutocomplete();
        const payload = 'http://x/"><img src=q onerror="window.__pwned=1">';
        ac.suggestions = [{ request: { method: 'GET', rawUrl: payload }, timestamp: 1 }];

        ac._render();

        expect(ac.dropdown.querySelector('img')).toBeNull();
        const urlEl = ac.dropdown.querySelector('.url-autocomplete-url');
        expect(urlEl.textContent).toBe(payload);
        expect(urlEl.getAttribute('title')).toBe(payload);
        expect(window.__pwned).toBeUndefined();
    });

    it('escapes markup in the title attribute too', () => {
        const ac = makeAutocomplete();
        const payload = '"><script>window.__pwned=1</script>';
        ac.suggestions = [{ request: { method: 'GET', url: payload }, timestamp: 1 }];

        ac._render();

        expect(ac.dropdown.querySelector('script')).toBeNull();
        expect(window.__pwned).toBeUndefined();
    });

    it('renders a normal entry with method, url, and time spans', () => {
        const ac = makeAutocomplete();
        ac.suggestions = [
            { request: { method: 'POST', rawUrl: 'https://api.example.com/users' }, timestamp: 1 }
        ];

        ac._render();

        const item = ac.dropdown.querySelector('.url-autocomplete-item');
        expect(item.querySelector('.url-autocomplete-method').textContent).toBe('POST');
        expect(item.querySelector('.url-autocomplete-url').textContent).toBe(
            'https://api.example.com/users'
        );
        expect(item.querySelector('.url-autocomplete-time').textContent).toBe('Just now');
    });

    it('selecting a rendered entry passes the raw entry through without executing markup', () => {
        const ac = makeAutocomplete();
        const payload = 'http://x/"><img src=q onerror="window.__pwned=1">';
        const entry = { request: { method: 'GET', rawUrl: payload }, timestamp: 1 };
        ac.suggestions = [entry];
        ac._render();

        const item = ac.dropdown.querySelector('.url-autocomplete-item');
        item.dispatchEvent(new window.MouseEvent('mousedown'));

        expect(ac.historyController.handleHistorySelect).toHaveBeenCalledWith(entry);
        expect(window.__pwned).toBeUndefined();
    });
});
