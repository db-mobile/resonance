/* global document, window, DOMParser, MouseEvent */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { RunnerResultsPanel } from '../../src/modules/ui/runner/RunnerResultsPanel.js';

const TEMPLATE_PATH = './src/templates/runner/runnerPanel.html';

function seedTemplates() {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/runner/runnerPanel.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

function mount() {
    const container = document.createElement('div');
    container.innerHTML = '<div class="runner-panel"><div class="runner-main"></div></div>';
    document.body.appendChild(container);
    const panel = new RunnerResultsPanel(container);
    return { container, panel };
}

const REQUESTS = [
    { method: 'GET', name: 'List users' },
    { method: 'POST', name: 'Create user' }
];

describe('RunnerResultsPanel', () => {
    beforeEach(seedTemplates);

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('open() renders one pending item per request and iteration', () => {
        const { container, panel } = mount();
        panel.open(REQUESTS, { iterations: 2, labels: ['first', 'second'] });

        const items = container.querySelectorAll('.runner-result-item');
        expect(items).toHaveLength(4);
        expect(items[0].querySelector('[data-role="method"]').textContent).toBe('GET');
        expect(items[0].querySelector('[data-role="status-icon"]').classList.contains('is-pending')).toBe(true);
        const headers = Array.from(container.querySelectorAll('.runner-results-iteration')).map(h => h.textContent);
        expect(headers).toEqual(['Iteration 1 · first', 'Iteration 2 · second']);
    });

    test('selecting a finished item fills the detail panel with body, headers and cookies', () => {
        const { container, panel } = mount();
        panel.open(REQUESTS);

        panel.updateResultWithResponse(0, {
            status: 'success',
            statusCode: 200,
            time: 12,
            body: { ok: true },
            headers: { 'content-type': 'application/json', 'x-count': 2 },
            cookies: [{ name: 'sid', value: 'abc', domain: 'example.com' }],
            testResults: [{ passed: true, message: 'status ok' }],
            logs: ['hello']
        });
        container.querySelectorAll('.runner-result-item')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const detail = panel.dom;
        expect(detail.detailPanel.classList.contains('is-hidden')).toBe(false);
        expect(detail.detailMethod.textContent).toBe('GET');
        expect(detail.detailName.textContent).toBe('List users');
        expect(detail.detailStatus.textContent).toBe('200 OK');
        expect(detail.detailStatus.classList.contains('is-success')).toBe(true);
        expect(detail.detailTime.textContent).toBe('12ms');
        expect(detail.bodyContent.textContent).toBe(JSON.stringify({ ok: true }, null, 2));

        const headerRows = Array.from(detail.headersBody.querySelectorAll('tr'));
        expect(headerRows.map(r => Array.from(r.children).map(td => td.textContent)))
            .toEqual([['content-type', 'application/json'], ['x-count', '2']]);

        const cookieRows = Array.from(detail.cookiesBody.querySelectorAll('tr'));
        expect(cookieRows).toHaveLength(1);
        expect(Array.from(cookieRows[0].children).map(td => td.textContent)).toEqual(['sid', 'abc', 'example.com', '/']);
        expect(detail.noCookies.classList.contains('is-hidden')).toBe(true);

        expect(detail.testsList.querySelectorAll('.runner-results-test')).toHaveLength(1);
        expect(detail.testsCount.textContent).toBe('1/1');
        expect(detail.consoleList.querySelectorAll('.runner-results-log')).toHaveLength(1);
        expect(detail.logsCount.textContent).toBe('1');
    });

    test('an item without headers or cookies renders the placeholder row and the no-cookies notice', () => {
        const { container, panel } = mount();
        panel.open(REQUESTS);

        panel.updateResultWithResponse(1, { status: 'error', error: 'boom', body: 'plain text', headers: {}, cookies: [] });
        container.querySelectorAll('.runner-result-item')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const detail = panel.dom;
        expect(detail.detailStatus.textContent).toBe('Failed');
        expect(detail.detailError.textContent).toBe('boom');
        expect(detail.detailError.classList.contains('is-hidden')).toBe(false);
        expect(detail.bodyContent.textContent).toBe('plain text');

        const headerRows = detail.headersBody.querySelectorAll('tr');
        expect(headerRows).toHaveLength(1);
        const cell = headerRows[0].firstElementChild;
        expect(cell.tagName).toBe('TD');
        expect(cell.getAttribute('colspan')).toBe('2');
        expect(cell.className).toBe('runner-table-empty-cell');
        expect(cell.textContent).toBe('No headers');

        expect(detail.cookiesBody.children).toHaveLength(0);
        expect(detail.noCookies.classList.contains('is-hidden')).toBe(false);
    });

    test('a result restored from history shows the history notice instead of a body', () => {
        const { container, panel } = mount();
        panel.showSummary({
            requests: [{ method: 'GET', name: 'x', status: 'success', statusCode: 200, time: 1, iteration: 1, tests: [] }],
            iterations: 1,
            summary: { passed: 1, failed: 0, skipped: 0 },
            totalTime: 1
        }, 'Yesterday');

        container.querySelector('.runner-result-item').dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(panel.dom.bodyContent.textContent).toBe('Response bodies, headers and cookies are not kept in run history');
        expect(panel.dom.source.textContent).toBe('Yesterday');
        expect(panel.dom.passed.textContent).toBe('1');
        expect(panel.dom.totalTime.textContent).toBe('1ms');
    });

    test('a null body shows the no-body placeholder', () => {
        const { container, panel } = mount();
        panel.open(REQUESTS);
        panel.updateResultWithResponse(0, { status: 'success', statusCode: 204, body: null });
        container.querySelector('.runner-result-item').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(panel.dom.bodyContent.textContent).toBe('(No response body)');
    });

    test('dragging the resizer resizes the panel and restores the body styles', () => {
        const { container, panel } = mount();
        panel.open(REQUESTS);
        const runnerMain = container.querySelector('.runner-main');
        Object.defineProperty(panel.panel, 'offsetHeight', { value: 300, configurable: true });
        Object.defineProperty(runnerMain, 'offsetHeight', { value: 500, configurable: true });
        window.innerHeight = 1000;

        panel.resizer.dispatchEvent(new MouseEvent('mousedown', { clientY: 400, bubbles: true }));
        expect(panel.resizer.classList.contains('is-dragging')).toBe(true);
        expect(document.body.style.cursor).toBe('row-resize');

        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 350 }));
        expect(panel.panel.style.height).toBe('350px');
        expect(runnerMain.style.flex).toBe('0 0 450px');

        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(panel.resizer.classList.contains('is-dragging')).toBe(false);
        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
    });
});
