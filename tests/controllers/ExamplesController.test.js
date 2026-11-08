/* global document, DOMParser */
import { readFileSync } from 'node:fs';

jest.mock('../../src/modules/ui/Toast.js', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { ExamplesController } from '../../src/modules/controllers/ExamplesController.js';
import { EXAMPLES_CHANGED_EVENT } from '../../src/modules/services/ExamplesService.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { deferred } from '../helpers/coreExecution.js';

const EXAMPLES = [
    { id: 'a', name: '200 OK', status: 200, statusText: 'OK', contentType: 'application/json; charset=utf-8', body: '{"ok":true}', savedAt: '2026-11-08T10:15:00.000Z' },
    { id: 'b', name: 'Missing', status: 404, body: 'nope' },
    { id: 'c', name: 'Image', status: 200, contentType: 'image/png', body: 'AAAA', bodyEncoding: 'base64' }
];

function setup() {
    document.body.innerHTML = `
        <span id="examples-count" class="badge is-hidden"></span>
        <div id="examples-list"></div>
        <p id="examples-empty" class="is-hidden"></p>`;
    templateLoader.cache.set('./src/templates/examples/exampleRow.html',
        new DOMParser().parseFromString(readFileSync('src/templates/examples/exampleRow.html', 'utf8'), 'text/html'));
    const service = {
        getExamples: jest.fn().mockResolvedValue(EXAMPLES),
        renameExample: jest.fn().mockResolvedValue([]),
        deleteExample: jest.fn().mockResolvedValue([])
    };
    const confirmDialog = { show: jest.fn().mockResolvedValue(true) };
    const renameDialog = { show: jest.fn().mockResolvedValue('Renamed') };
    const previewModal = { show: jest.fn() };
    const target = document.createElement('div');
    const controller = new ExamplesController({ service, confirmDialog, renameDialog, previewModal, eventTarget: target });
    controller.initialize();
    return { controller, service, confirmDialog, renameDialog, previewModal, target };
}

function rows() {
    return [...document.querySelectorAll('#examples-list .example-row')].map((row) => ({
        id: row.dataset.exampleId,
        name: row.querySelector('.example-name').textContent,
        status: row.querySelector('.example-status').className,
        meta: row.querySelector('.example-meta').textContent
    }));
}

describe('ExamplesController', () => {
    afterEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '';
    });

    test('starts empty and renders rows with status classes, meta and labelled actions after loading', async () => {
        const { controller } = setup();
        expect(document.getElementById('examples-empty').classList.contains('is-hidden')).toBe(false);

        await controller.loadExamples('c1', 'e1');

        expect(rows().map((r) => [r.id, r.name, r.status])).toEqual([
            ['a', '200 OK', 'status-display example-status status-success'],
            ['b', 'Missing', 'status-display example-status status-client-error'],
            ['c', 'Image', 'status-display example-status status-success']
        ]);
        expect(rows()[0].meta).toMatch(/^application\/json · 11 B · /);
        expect(rows()[2].meta).toBe('image/png · 3 B');
        expect(document.getElementById('examples-count').textContent).toBe('3 examples');
        expect(document.getElementById('examples-count').classList.contains('is-hidden')).toBe(false);
        expect(document.getElementById('examples-empty').classList.contains('is-hidden')).toBe(true);
        expect(document.querySelector('[data-action="delete"]').getAttribute('aria-label')).toBe('Delete example');
    });

    test('a slower load for an earlier endpoint never overwrites the current one', async () => {
        const { controller, service } = setup();
        const slow = deferred();
        service.getExamples.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([EXAMPLES[1]]);

        const first = controller.loadExamples('c1', 'old');
        await controller.loadExamples('c1', 'new');
        slow.resolve(EXAMPLES);
        await first;

        expect(rows().map((r) => r.id)).toEqual(['b']);
        expect(controller.currentEndpointId).toBe('new');
    });

    test('clearContext empties the list and ignores a load that finishes afterwards', async () => {
        const { controller, service } = setup();
        const slow = deferred();
        service.getExamples.mockReturnValueOnce(slow.promise);

        const load = controller.loadExamples('c1', 'e1');
        controller.clearContext();
        slow.resolve(EXAMPLES);
        await load;

        expect(rows()).toEqual([]);
        expect(document.getElementById('examples-count').classList.contains('is-hidden')).toBe(true);
    });

    test('a failed load reports once and shows the empty state', async () => {
        const { controller, service } = setup();
        service.getExamples.mockRejectedValueOnce(new Error('disk'));

        await controller.loadExamples('c1', 'e1');

        expect(toast.error).toHaveBeenCalledWith('Failed to load examples: disk');
        expect(rows()).toEqual([]);
    });

    test('re-renders from the change event only for the current endpoint', async () => {
        const { controller, target } = setup();
        await controller.loadExamples('c1', 'e1');

        target.dispatchEvent(new CustomEvent(EXAMPLES_CHANGED_EVENT, { detail: { collectionId: 'c1', endpointId: 'other', examples: [] } }));
        expect(rows()).toHaveLength(3);
        target.dispatchEvent(new CustomEvent(EXAMPLES_CHANGED_EVENT, { detail: { collectionId: 'c1', endpointId: 'e1', examples: [EXAMPLES[0]] } }));
        expect(rows()).toHaveLength(1);
    });

    test('view, rename and delete route through the dialogs and service', async () => {
        const { controller, service, confirmDialog, renameDialog, previewModal } = setup();
        await controller.loadExamples('c1', 'e1');

        document.querySelector('[data-example-id="a"] [data-action="view"]').click();
        expect(previewModal.show).toHaveBeenCalledWith(EXAMPLES[0]);

        document.querySelector('[data-example-id="b"] [data-action="rename"]').click();
        await Promise.resolve();
        await Promise.resolve();
        expect(renameDialog.show).toHaveBeenCalledWith('Missing', expect.objectContaining({ title: 'Rename example' }));
        expect(service.renameExample).toHaveBeenCalledWith('c1', 'e1', 'b', 'Renamed');
        expect(toast.success).toHaveBeenCalledWith('Example renamed');

        document.querySelector('[data-example-id="c"] [data-action="delete"]').click();
        await Promise.resolve();
        await Promise.resolve();
        expect(confirmDialog.show).toHaveBeenCalledWith('Delete the example "Image"? This cannot be undone.', expect.objectContaining({ dangerous: true }));
        expect(service.deleteExample).toHaveBeenCalledWith('c1', 'e1', 'c');
        expect(toast.success).toHaveBeenCalledWith('Example deleted');
    });

    test('cancelled or unchanged rename and declined delete write nothing', async () => {
        const { controller, service, confirmDialog, renameDialog } = setup();
        await controller.loadExamples('c1', 'e1');
        renameDialog.show.mockResolvedValueOnce(null).mockResolvedValueOnce('Missing');
        confirmDialog.show.mockResolvedValueOnce(false);

        await controller.renameExample('b');
        await controller.renameExample('b');
        await controller.deleteExample('c');
        await controller.renameExample('unknown');

        expect(service.renameExample).not.toHaveBeenCalled();
        expect(service.deleteExample).not.toHaveBeenCalled();
    });

    test('service failures during rename or delete surface as errors', async () => {
        const { controller, service } = setup();
        await controller.loadExamples('c1', 'e1');
        service.deleteExample.mockRejectedValueOnce(new Error('ro'));

        await controller.deleteExample('a');

        expect(toast.error).toHaveBeenCalledWith('Failed to save example: ro');
    });

    test('destroy stops listening and initialize is safe without the panel', () => {
        const { controller, target } = setup();
        controller.destroy();
        target.dispatchEvent(new CustomEvent(EXAMPLES_CHANGED_EVENT, { detail: { collectionId: null, endpointId: null, examples: EXAMPLES } }));
        expect(rows()).toEqual([]);

        document.body.innerHTML = '';
        const bare = new ExamplesController({ service: {}, confirmDialog: {}, renameDialog: {}, previewModal: {}, eventTarget: null });
        expect(() => bare.initialize()).not.toThrow();
        expect(() => bare.render(EXAMPLES)).not.toThrow();
    });
});
