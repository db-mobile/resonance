/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { ScriptConsolePanel } from '../../src/modules/ui/ScriptConsolePanel.js';

const TEMPLATE_PATH = './src/templates/scripts/scriptConsolePanel.html';

function seedTemplates() {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/scripts/scriptConsolePanel.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new ScriptConsolePanel(container);
    return { container, panel, content: () => container.querySelector('.script-console-content') };
}

describe('ScriptConsolePanel', () => {
    beforeEach(seedTemplates);

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('initialises with the header, a clear button and the empty state', () => {
        const { container, content } = mount();

        expect(container.classList.contains('script-console-container')).toBe(true);
        expect(container.querySelector('.script-console-header')).not.toBeNull();
        expect(container.querySelector('.clear-console-btn')).not.toBeNull();
        expect(content().querySelector('.script-console-empty')).not.toBeNull();
        expect(content().querySelector('.script-console-empty').textContent).toBe('');
    });

    test('show() renders errors before logs with level classes, icons and times', () => {
        const { panel, content } = mount();
        const timestamp = new Date(2024, 0, 1, 13, 5, 9).getTime();

        panel.show(
            [{ level: 'warn', message: 'careful', timestamp }, { level: 'log', message: 'plain', timestamp }],
            ['boom']
        );

        const entries = Array.from(content().querySelectorAll('.script-console-entry'));
        expect(entries.map(e => e.querySelector('[data-role="message"]').textContent)).toEqual(['boom', 'careful', 'plain']);
        expect(entries[0].classList.contains('is-error')).toBe(true);
        expect(entries[0].querySelector('[data-role="icon"]').textContent).toBe('✗');
        expect(entries[1].classList.contains('is-warn')).toBe(true);
        expect(entries[1].querySelector('[data-role="icon"]').textContent).toBe('⚠');
        expect(entries[1].querySelector('[data-role="time"]').textContent).toBe('13:05:09');
        expect(entries[2].classList.contains('is-default')).toBe(true);
        expect(entries[2].querySelector('[data-role="icon"]').textContent).toBe('ℹ');
    });

    test('show() with nothing to show renders the empty state', () => {
        const { panel, content } = mount();
        panel.show([], []);
        expect(content().querySelector('.script-console-empty')).not.toBeNull();
        expect(content().querySelectorAll('.script-console-entry')).toHaveLength(0);
    });

    test('appendEntry() uses the info icon and class for info level', () => {
        const { panel, content } = mount();
        panel.appendEntry(content(), 'info', 'note', Date.now());
        const entry = content().querySelector('.script-console-entry');
        expect(entry.classList.contains('is-info')).toBe(true);
        expect(entry.querySelector('[data-role="icon"]').textContent).toBe('ℹ');
    });

    test('showTestResults() renders an all-passed summary and the test list', () => {
        const { panel, content } = mount();

        panel.showTestResults({
            testResults: [{ passed: true, message: 'a' }, { passed: true, message: 'b' }],
            logs: [],
            errors: []
        });

        const summary = content().querySelector('.script-console-summary');
        expect(summary).toBe(content().firstElementChild);
        expect(summary.textContent).toBe('');
        expect(summary.children).toHaveLength(0);
        const items = Array.from(content().querySelectorAll('.script-console-test-item'));
        expect(items).toHaveLength(2);
        expect(items[0].classList.contains('is-passed')).toBe(true);
        expect(items[0].querySelector('[data-role="icon"]').textContent).toBe('✓');
        expect(items[0].style.getPropertyValue('--script-console-accent')).toBe('var(--color-success, #10b981)');
        expect(content().querySelectorAll('.script-console-separator')).toHaveLength(0);
    });

    test('showTestResults() renders the mixed summary, separators, logs and errors', () => {
        const { panel, content } = mount();

        panel.showTestResults({
            testResults: [{ passed: true, message: 'a' }, { passed: false, message: 'b' }],
            logs: [{ level: 'log', message: 'hello', timestamp: Date.now() }],
            errors: ['bad']
        });

        const summary = content().querySelector('.script-console-summary');
        expect(summary.textContent).toBe('');
        expect(summary.children).toHaveLength(0);

        const failedItem = content().querySelectorAll('.script-console-test-item')[1];
        expect(failedItem.classList.contains('is-failed')).toBe(true);
        expect(failedItem.querySelector('[data-role="icon"]').textContent).toBe('✗');
        expect(failedItem.style.getPropertyValue('--script-console-accent')).toBe('var(--color-error, #ef4444)');

        const separators = Array.from(content().querySelectorAll('.script-console-separator'));
        expect(separators).toHaveLength(2);
        expect(separators.map(s => s.textContent)).toEqual(['', '']);
        expect(separators[0].classList.contains('script-console-separator--error')).toBe(false);
        expect(separators[1].classList.contains('script-console-separator--error')).toBe(true);
        const ordered = Array.from(content().children).map(node => node.className.split(' ')[0]);
        expect(ordered).toEqual([
            'script-console-summary', 'script-console-test-list',
            'script-console-separator', 'script-console-entry',
            'script-console-separator', 'script-console-entry'
        ]);

        const entries = Array.from(content().querySelectorAll('.script-console-entry'));
        expect(entries.map(e => e.querySelector('[data-role="message"]').textContent)).toEqual(['hello', 'bad']);
        expect(entries[1].classList.contains('is-error')).toBe(true);
    });

    test('showTestResults() with no tests says so and renders no list', () => {
        const { panel, content } = mount();
        panel.showTestResults({ testResults: [], logs: [], errors: [] });
        expect(content().querySelector('.script-console-summary').textContent).toBe('');
        expect(content().querySelector('.script-console-test-list')).toBeNull();
        expect(content().children).toHaveLength(1);
    });

    test('clear() returns to the empty state', () => {
        const { panel, content } = mount();
        panel.show([{ level: 'log', message: 'x', timestamp: Date.now() }], []);
        panel.clear();
        expect(content().querySelector('.script-console-empty')).not.toBeNull();
        expect(content().querySelectorAll('.script-console-entry')).toHaveLength(0);
    });
});
