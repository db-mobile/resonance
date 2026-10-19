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

test('getRunnerData carries the bound collection and no derived fields', () => {
    const panel = mount();
    panel.updateCollections([{ id: 'c1', name: 'Petstore', endpoints: [] }]);
    panel.queue.setRequests([{ collectionId: 'c1', endpointId: 'one', name: 'One' }]);
    panel.setDataFile({ path: 'data/users.csv', name: 'users.csv' }, { rowCount: 3, portable: true });

    const data = panel.getRunnerData();

    expect(data.collectionId).toBe('c1');
    expect(data).not.toHaveProperty('overridesVersion');
    expect(data.options.dataFile).toEqual({ path: 'data/users.csv', name: 'users.csv' });
    expect(panel.dom.collectionChip.textContent).toBe('in Petstore');
    expect(panel.dom.collectionChip.classList.contains('is-hidden')).toBe(false);
});

test('a loaded runner binds the tab to its collection even with an empty queue, a new runner releases it', () => {
    const panel = mount();
    panel.loadRunner({ id: 'r1', collectionId: 'c9', name: 'Saved', options: {}, requests: [] });
    expect(panel.collectionId).toBe('c9');

    panel.startNewRunner();
    expect(panel.collectionId).toBeNull();
    expect(panel.dom.collectionChip.classList.contains('is-hidden')).toBe(true);
});

test('an absolute data file path shows the not-portable hint', () => {
    const panel = mount();
    panel.setDataFile({ path: '/tmp/users.csv', name: 'users.csv' }, { rowCount: 1, portable: false });
    expect(panel.dom.dataChip.classList.contains('is-not-portable')).toBe(true);
    expect(panel.dom.dataChip.title).toContain('Outside the collection folder');
});
