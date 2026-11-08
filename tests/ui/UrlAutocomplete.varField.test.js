/* global document */
import { UrlAutocomplete } from '../../src/modules/ui/UrlAutocomplete.js';
import { decorateInput } from '../../src/modules/ui/inputDecorator.js';

function historyStub() {
    return {
        handleHistorySelect: jest.fn(),
        service: { formatTimestamp: () => '', getMethodColor: () => '', searchHistory: async () => [] }
    };
}

describe('UrlAutocomplete with a decorated URL input', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('wraps the var-field so the overlay stays inside the autocomplete wrapper', () => {
        const section = document.createElement('div');
        section.className = 'request-url-section';
        const input = document.createElement('input');
        input.type = 'url';
        input.id = 'url-input';
        section.appendChild(input);
        document.body.appendChild(section);
        decorateInput(input, { url: true });

        const ac = new UrlAutocomplete(input, historyStub());
        ac.init();

        const wrapper = section.querySelector('.url-autocomplete-wrapper');
        expect(wrapper.children[0].className).toContain('var-field');
        expect(wrapper.children[0].querySelector('#url-input')).toBe(input);
        expect(wrapper.children[1]).toBe(ac.dropdown);
        expect(input.closest('.url-autocomplete-wrapper')).toBe(wrapper);
    });

    test('moves a hidden state from the var-field to the wrapper', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        const field = decorateInput(input);
        field.style.display = 'none';

        new UrlAutocomplete(input, historyStub()).init();

        const wrapper = document.querySelector('.url-autocomplete-wrapper');
        expect(wrapper.style.display).toBe('none');
        expect(field.style.display).toBe('');
    });
});
