/* global document, DOMParser, KeyboardEvent */
/** @fileoverview Alt+N / Alt+Shift+N follow the visible request and response tabs left to right. */

import fs from 'fs';
import path from 'path';
import { keyboardShortcuts } from '../../src/modules/keyboardShortcuts.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { setRequestMode, RequestMode } from '../../src/modules/requestModeManager.js';
import { visibleTabButtons } from '../../src/modules/tabManager.js';
import { registerTabShortcuts, MAX_TAB_SHORTCUTS } from '../../src/modules/tabShortcuts.js';
import {
    buildRequestBar,
    installGraphqlBodyManagerStub,
    resetRequestBar,
    visibleRequestTabs,
    activeRequestTab
} from '../helpers/requestBarFixture.js';

const TEMPLATE = './src/templates/shortcuts/keyboardShortcuts.html';
const MODES = [
    RequestMode.HTTP,
    RequestMode.GRPC,
    RequestMode.SSE,
    RequestMode.WEBSOCKET,
    RequestMode.MQTT,
    RequestMode.GRAPHQL
];

/**
 * @param {number} digit
 * @param {{shift?: boolean, alt?: boolean, target?: Element}} [options]
 */
function press(digit, { shift = false, alt = true, target = document.body } = {}) {
    target.dispatchEvent(new KeyboardEvent('keydown', {
        code: `Digit${digit}`,
        key: String(digit),
        altKey: alt,
        shiftKey: shift,
        bubbles: true
    }));
}

/** @returns {?string} */
function activeResponseTab() {
    return document.querySelector('.response-tabs .tab-button.active')?.dataset.tab ?? null;
}

/** @returns {string[]} */
function visibleResponseTabs() {
    return visibleTabButtons('response').map(btn => btn.dataset.tab);
}

/**
 * @param {string} title
 * @returns {{labels: string[], keys: string[]}}
 */
function helpRows(title) {
    const category = Array.from(document.querySelectorAll('#keyboard-shortcuts-dialog .shortcuts-category'))
        .find(el => el.querySelector('[data-role="title"]').textContent === title);
    const items = Array.from(category?.querySelectorAll('.shortcut-item') ?? []);
    return {
        labels: items.map(el => el.querySelector('[data-role="description"]').textContent),
        keys: items.map(el => el.querySelector('[data-role="keys"]').textContent)
    };
}

describe('tab shortcuts follow the visible tabs', () => {
    beforeAll(() => {
        keyboardShortcuts.init();
        registerTabShortcuts(keyboardShortcuts);
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/shortcuts/keyboardShortcuts.html'), 'utf8');
        templateLoader.cache.set(TEMPLATE, new DOMParser().parseFromString(html, 'text/html'));
    });

    beforeEach(() => {
        keyboardShortcuts.helpDialogVisible = false;
        buildRequestBar();
        installGraphqlBodyManagerStub();
        document.querySelectorAll('.tab-button').forEach(btn => { btn.textContent = btn.dataset.tab; });
    });

    afterEach(() => {
        resetRequestBar();
    });

    describe.each(MODES)('request tabs in %s mode', (mode) => {
        test('Alt+N activates the N-th visible tab from the left', () => {
            setRequestMode(mode);
            const visible = visibleRequestTabs();
            expect(visible.length).toBeGreaterThan(0);
            visible.forEach((tab, index) => {
                press(index + 1);
                expect(activeRequestTab()).toBe(tab);
            });
        });

        test('Alt+N past the last visible tab does nothing and never reaches a hidden tab', () => {
            setRequestMode(mode);
            const visible = visibleRequestTabs();
            press(1);
            const before = activeRequestTab();
            for (let n = visible.length + 1; n <= MAX_TAB_SHORTCUTS; n++) {
                press(n);
                expect(activeRequestTab()).toBe(before);
            }
            expect(visible).toContain(activeRequestTab());
        });
    });

    test.each([
        [RequestMode.HTTP, ['response-body', 'response-headers', 'response-cookies', 'response-performance', 'response-scripts']],
        [RequestMode.GRPC, ['response-body', 'response-metadata', 'response-trailers']],
        [RequestMode.MQTT, ['response-body']]
    ])('Alt+Shift+N walks the visible response tabs in %s mode', (mode, expected) => {
        setRequestMode(mode);
        expect(visibleResponseTabs()).toEqual(expected);
        expected.forEach((tab, index) => {
            press(index + 1, { shift: true });
            expect(activeResponseTab()).toBe(tab);
        });
        press(expected.length + 1, { shift: true });
        expect(activeResponseTab()).toBe(expected[expected.length - 1]);
    });

    test('Alt+N works while focus is in an input or a CodeMirror editor', () => {
        setRequestMode(RequestMode.HTTP);
        const input = document.getElementById('url-input');
        press(4, { target: input });
        expect(activeRequestTab()).toBe('body');

        const editor = document.createElement('div');
        editor.className = 'cm-editor';
        const content = document.createElement('div');
        editor.appendChild(content);
        document.body.appendChild(editor);
        press(3, { target: content });
        expect(activeRequestTab()).toBe('headers');
    });

    test('non-modifier shortcuts still stay out of inputs', () => {
        const handler = jest.fn();
        keyboardShortcuts.register('KeyZ', { handler, description: 'test' });
        document.getElementById('url-input').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }));
        expect(handler).not.toHaveBeenCalled();
        document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('help dialog lists only the currently visible tabs, in order, with their labels', () => {
        setRequestMode(RequestMode.GRPC);
        keyboardShortcuts.showHelp();

        const request = helpRows('Request Tabs');
        expect(request.labels).toEqual([
            'Switch to grpc tab',
            'Switch to grpc-message tab',
            'Switch to grpc-metadata tab',
            'Switch to authorization tab'
        ]);
        expect(request.keys).toEqual(['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4']);

        const response = helpRows('Response Tabs');
        expect(response.labels).toEqual([
            'Switch to response-body tab',
            'Switch to response-metadata tab',
            'Switch to response-trailers tab'
        ]);
        expect(response.keys).toEqual(['Shift+Alt+1', 'Shift+Alt+2', 'Shift+Alt+3']);
        document.getElementById('close-shortcuts-btn').click();
    });

    test('re-registering a shortcut does not duplicate help rows', () => {
        setRequestMode(RequestMode.HTTP);
        registerTabShortcuts(keyboardShortcuts);
        keyboardShortcuts.showHelp();
        expect(helpRows('Request Tabs').keys).toEqual(['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7']);
        document.getElementById('close-shortcuts-btn').click();
    });
});
