/* global document */
import { PreviewManager } from '../../src/modules/PreviewManager.js';
import { PreviewRenderer } from '../../src/modules/ui/PreviewRenderer.js';
import { PreviewRepository } from '../../src/modules/storage/PreviewRepository.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

describe('PreviewManager hidden-pane guard', () => {
    let manager;
    let repository;
    let renderer;

    beforeEach(async () => {
        repository = new PreviewRepository({
            store: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined) }
        });
        await repository.load();
        manager = new PreviewManager(repository);
        renderer = { render: jest.fn(), clear: jest.fn() };
        manager.containers.set('tab-1', {
            renderer,
            editor: { getContent: () => '{}', currentLanguage: 'json' },
            previewContainer: document.createElement('div'),
            codeContainer: document.createElement('div')
        });
    });

    test('refreshPreviewContent skips rendering while the preview pane is hidden', () => {
        manager.refreshPreviewContent('tab-1', '{"a":1}', 'json');

        expect(renderer.render).not.toHaveBeenCalled();
    });

    test('refreshPreviewContent renders when preview mode is active', () => {
        repository.setPreviewMode('tab-1', true);

        manager.refreshPreviewContent('tab-1', '{"a":1}', 'json');

        expect(renderer.render).toHaveBeenCalledWith('{"a":1}', 'json');
    });
});

describe('PreviewRenderer size caps', () => {
    let container;
    let renderer;

    beforeEach(() => {
        const errorTemplate = `
            <template id="tpl-preview-error"><div class="preview-error"><span data-role="message"></span></div></template>
            <template id="tpl-preview-empty"><div class="preview-empty"></div></template>
        `;
        const doc = document.implementation.createHTMLDocument('t');
        doc.body.innerHTML = errorTemplate;
        templateLoader.cache.set('./src/templates/preview/previewRenderer.html', doc);

        container = document.createElement('div');
        renderer = new PreviewRenderer(container);
    });

    test('content beyond the char cap renders the too-large notice instead of a tree', () => {
        const huge = `{"blob":"${'x'.repeat(600 * 1024)}"}`;

        renderer.render(huge, 'json');

        expect(container.textContent).toContain('too large to preview');
        expect(container.querySelector('.json-tree')).toBeNull();
    });

    test('wide arrays are truncated with a more-entries leaf', () => {
        const arr = JSON.stringify(Array.from({ length: 450 }, (_, i) => i));

        renderer.render(arr, 'json');

        expect(container.textContent).toContain('250 more entries not shown');
        expect(container.querySelectorAll('.json-tree-line').length).toBeLessThan(260);
    });

    test('wide objects are truncated the same way', () => {
        const obj = {};
        for (let i = 0; i < 320; i++) {
            obj[`k${i}`] = i;
        }

        renderer.render(JSON.stringify(obj), 'json');

        expect(container.textContent).toContain('120 more entries not shown');
    });
});
