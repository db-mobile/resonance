/* global DOMParser, document */
import fs from 'fs';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { RunnerPanel } from '../../src/modules/ui/RunnerPanel.js';

jest.mock('../../src/modules/ui/runner/RequestEditorModal.js', () => ({ RequestEditorModal: jest.fn() }));

function mount() {
    const html = fs.readFileSync('src/templates/runner/runnerPanel.html', 'utf8');
    templateLoader.cache.set('./src/templates/runner/runnerPanel.html', new DOMParser().parseFromString(html, 'text/html'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const panel = new RunnerPanel(container);
    panel.render([]);
    return panel;
}

afterEach(() => { document.body.innerHTML = ''; });

test('an empty execution limit prevents running instead of submitting zero', () => {
    const panel = mount();
    panel.queue.setRequests([{ endpointId: 'one', name: 'One' }]);
    panel.onRun = jest.fn();
    panel.dom.maxExecutionsInput.value = '';
    panel.dom.runButton.click();
    expect(panel.onRun).not.toHaveBeenCalled();
    expect(panel.dom.maxExecutionsInput.checkValidity()).toBe(false);
});

test('the default execution limit grows to cover a selected queue larger than 1000', () => {
    const panel = mount();
    panel.queue.setRequests(Array.from({ length: 1001 }, (_, index) => ({ endpointId: String(index), name: 'Request' })));
    expect(panel.dom.maxExecutionsInput.value).toBe('1001');
    expect(panel.dom.maxExecutionsInput.checkValidity()).toBe(true);
});
