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

test('the tag inputs feed a normalized filter into the runner options', () => {
    const panel = mount();
    panel.dom.tagsIncludeInput.value = ' smoke, Pets ,smoke';
    panel.dom.tagsExcludeInput.value = 'slow';

    expect(panel.getRunnerData().options.tags).toEqual({ include: ['smoke', 'Pets'], exclude: ['slow'] });
});

test('a loaded runner fills the tag inputs and a new runner clears them', () => {
    const panel = mount();
    panel.loadRunner({ id: 'r1', collectionId: 'c1', name: 'Saved', options: { tags: { include: ['smoke'], exclude: ['slow', 'flaky'] } }, requests: [] });
    expect(panel.dom.tagsIncludeInput.value).toBe('smoke');
    expect(panel.dom.tagsExcludeInput.value).toBe('slow, flaky');

    panel.startNewRunner();
    expect(panel.dom.tagsIncludeInput.value).toBe('');
    expect(panel.dom.tagsExcludeInput.value).toBe('');
    expect(panel.getRunnerData().options.tags).toEqual({ include: [], exclude: [] });
});
