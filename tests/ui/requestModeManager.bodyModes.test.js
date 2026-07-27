/* global document */
import { setRequestMode, RequestMode } from '../../src/modules/requestModeManager.js';

const ALL_MODES = [
    ['json', 'JSON'],
    ['formdata', 'Form Data'],
    ['urlencoded', 'URL Encoded'],
    ['text', 'Text'],
    ['binary', 'Binary File']
];

function buildRequestBar() {
    document.body.innerHTML = `
        <div class="request-url-section">
            <div class="method-select-container">
                <select id="method-select">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                </select>
            </div>
            <input id="url-input" />
            <button id="curl-btn"></button>
        </div>
        <div class="request-config">
            <div class="tab-nav">
                <button class="tab-button" data-tab="path-params"></button>
                <button class="tab-button" data-tab="query-params"></button>
                <button class="tab-button" data-tab="headers"></button>
                <button class="tab-button active" data-tab="body"></button>
                <button class="tab-button" data-tab="authorization"></button>
                <button class="tab-button" data-tab="scripts"></button>
            </div>
        </div>
        <div id="body">
            <h3>Body</h3>
            <div class="body-mode-selector-container">
                <select id="body-mode-select"></select>
            </div>
        </div>
    `;

    const select = document.getElementById('body-mode-select');
    for (const [value, text] of ALL_MODES) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    }
    return select;
}

const modeValues = () =>
    Array.from(document.getElementById('body-mode-select').options, (o) => o.value);

describe('body modes per request mode', () => {
    beforeEach(() => {
        buildRequestBar();
        setRequestMode(RequestMode.HTTP);
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('SSE offers only the document body modes', () => {
        setRequestMode(RequestMode.SSE);
        expect(modeValues()).toEqual(['json', 'text']);
    });

    test('removes disallowed options rather than hiding them', () => {
        // WebKit ignores `hidden` on <option>, so a hidden entry would still be
        // selectable in the real app. The options must actually be gone.
        setRequestMode(RequestMode.SSE);

        const select = document.getElementById('body-mode-select');
        expect(select.options).toHaveLength(2);
        expect(select.querySelector('option[value="binary"]')).toBeNull();
        expect(Array.from(select.options).some((o) => o.hidden)).toBe(false);
    });

    test('restores the full list when leaving SSE', () => {
        setRequestMode(RequestMode.SSE);
        setRequestMode(RequestMode.HTTP);

        expect(modeValues()).toEqual(ALL_MODES.map(([value]) => value));
        expect(
            Array.from(document.getElementById('body-mode-select').options, (o) => o.textContent)
        ).toEqual(ALL_MODES.map(([, text]) => text));
    });

    test('keeps a still-valid selection when entering SSE', () => {
        const select = document.getElementById('body-mode-select');
        select.value = 'text';

        setRequestMode(RequestMode.SSE);

        expect(select.value).toBe('text');
    });

    test('falls back to the first allowed mode when the selection disappears', () => {
        const select = document.getElementById('body-mode-select');
        select.value = 'binary';

        setRequestMode(RequestMode.SSE);

        expect(select.value).toBe('json');
    });

    test('shows the method select and the body and authorization tabs in SSE mode', () => {
        setRequestMode(RequestMode.SSE);

        const visibleTabs = Array.from(
            document.querySelectorAll('.request-config .tab-nav .tab-button')
        )
            .filter((btn) => btn.style.display !== 'none')
            .map((btn) => btn.dataset.tab);

        expect(visibleTabs).toEqual(['query-params', 'headers', 'body', 'authorization']);
        expect(document.querySelector('.method-select-container').style.display).not.toBe('none');
    });

    test('keeps the SSE badge alongside the method select', () => {
        setRequestMode(RequestMode.SSE);

        const badge = document.querySelector('#sse-url-section .method-pill');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toBe('SSE');
        expect(badge.dataset.method).toBe('SSE');
    });
});
