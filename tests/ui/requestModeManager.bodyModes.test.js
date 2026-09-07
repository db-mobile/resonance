/* global document */
/** @fileoverview Body-mode narrowing for SSE, focused on restrictBodyModes. */

import { setRequestMode, RequestMode } from '../../src/modules/requestModeManager.js';
import {
    ALL_BODY_MODES,
    buildRequestBar,
    resetRequestBar,
    visibleRequestTabs,
    bodyModeValues
} from '../helpers/requestBarFixture.js';

describe('body modes per request mode', () => {
    beforeEach(() => {
        buildRequestBar();
        setRequestMode(RequestMode.HTTP);
    });

    afterEach(resetRequestBar);

    test('SSE offers only the document body modes', () => {
        setRequestMode(RequestMode.SSE);
        expect(bodyModeValues()).toEqual(['json', 'text']);
    });

    test('removes disallowed options rather than hiding them', () => {
        setRequestMode(RequestMode.SSE);

        const select = document.getElementById('body-mode-select');
        expect(select.options).toHaveLength(2);
        expect(select.querySelector('option[value="binary"]')).toBeNull();
        expect(Array.from(select.options).some((o) => o.hidden)).toBe(false);
    });

    test('restores the full list when leaving SSE', () => {
        setRequestMode(RequestMode.SSE);
        setRequestMode(RequestMode.HTTP);

        expect(bodyModeValues()).toEqual(ALL_BODY_MODES.map(([value]) => value));
        expect(
            Array.from(document.getElementById('body-mode-select').options, (o) => o.textContent)
        ).toEqual(ALL_BODY_MODES.map(([, text]) => text));
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

        expect(visibleRequestTabs()).toEqual(['query-params', 'headers', 'body', 'authorization']);
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
