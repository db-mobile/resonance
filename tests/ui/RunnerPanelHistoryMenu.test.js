/* global DOMParser, document, KeyboardEvent */
import fs from 'fs';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { RunnerPanel } from '../../src/modules/ui/RunnerPanel.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

jest.mock('../../src/modules/ui/runner/RequestEditorModal.js', () => ({ RequestEditorModal: jest.fn() }));

/** @returns {RunnerPanel} */
function mount() {
    const html = fs.readFileSync('src/templates/runner/runnerPanel.html', 'utf8');
    templateLoader.cache.set('./src/templates/runner/runnerPanel.html', new DOMParser().parseFromString(html, 'text/html'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new RunnerPanel(container);
    panel.render([]);
    return panel;
}

/** @returns {{promise: Promise, resolve: Function}} */
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

const flush = () => new Promise((tick) => setTimeout(tick, 0));

afterEach(() => {
    document.body.innerHTML = '';
    expect(escapeHandlerCount()).toBe(0);
});

test('a second click while history loads does not register a second Escape handler', async () => {
    const panel = mount();
    const load = deferred();
    panel.currentRunnerId = 'r1';
    panel.onLoadHistory = jest.fn(() => load.promise);

    panel.dom.historyButton.click();
    panel.dom.historyButton.click();
    load.resolve([]);
    await flush();

    expect(panel.onLoadHistory).toHaveBeenCalledTimes(1);
    expect(escapeHandlerCount()).toBe(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(escapeHandlerCount()).toBe(0);
});

test('destroying the panel while history loads never opens the menu', async () => {
    const panel = mount();
    const load = deferred();
    panel.currentRunnerId = 'r1';
    panel.onLoadHistory = jest.fn(() => load.promise);

    panel.dom.historyButton.click();
    panel.destroy();
    load.resolve([]);
    await flush();

    expect(escapeHandlerCount()).toBe(0);
});
