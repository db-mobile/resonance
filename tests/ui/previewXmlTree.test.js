/* global document */
import { PreviewRenderer } from '../../src/modules/ui/PreviewRenderer.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

describe('PreviewRenderer XML tree', () => {
    let container;
    let renderer;

    beforeEach(() => {
        const doc = document.implementation.createHTMLDocument('t');
        doc.body.innerHTML = `
            <template id="tpl-preview-error"><div class="preview-error"><span data-role="message"></span></div></template>
            <template id="tpl-preview-empty"><div class="preview-empty"></div></template>
        `;
        templateLoader.cache.set('./src/templates/preview/previewRenderer.html', doc);

        container = document.createElement('div');
        renderer = new PreviewRenderer(container);
    });

    /**
     * @param {string} xml
     * @returns {HTMLElement}
     */
    function render(xml) {
        renderer.render(xml, 'xml');
        return container.querySelector('.xml-tree');
    }

    test('renders attributes on an element that has children', () => {
        const tree = render('<root id="r" lang="en"><child/></root>');

        const attrs = [...tree.querySelectorAll(':scope > .xml-tree-attribute')].map(n => n.textContent);
        const values = [...tree.querySelectorAll(':scope > .xml-tree-string')].map(n => n.textContent);

        expect(attrs).toEqual([' id', ' lang']);
        expect(values).toEqual(['"r"', '"en"']);
        expect(tree.querySelector(':scope > .xml-tree-tag').textContent).toBe('<root');
    });

    test('renders attributes on an element that has only text', () => {
        const tree = render('<root><name kind="given">Ada</name></root>');
        const child = tree.querySelector('.xml-tree-children .xml-tree-node');

        expect([...child.querySelectorAll(':scope > .xml-tree-attribute')].map(n => n.textContent))
            .toEqual([' kind']);
        expect([...child.querySelectorAll(':scope > .xml-tree-string')].map(n => n.textContent))
            .toEqual(['"given"']);
        expect(child.querySelector('.xml-tree-text').textContent).toBe('Ada');
    });

    test('renders attributes on a self-closing element and closes with a slash', () => {
        const tree = render('<root><link href="/a" rel="next"/></root>');
        const child = tree.querySelector('.xml-tree-children .xml-tree-node');

        expect([...child.querySelectorAll(':scope > .xml-tree-attribute')].map(n => n.textContent))
            .toEqual([' href', ' rel']);
        expect([...child.querySelectorAll(':scope > .xml-tree-string')].map(n => n.textContent))
            .toEqual(['"/a"', '"next"']);
        expect(child.textContent).toContain(' />');
    });

    test('emits name=value for every attribute', () => {
        const tree = render('<root a="1" b="2"><child/></root>');

        expect(tree.textContent.startsWith('▼<root a="1" b="2">')).toBe(true);
    });

    test('renders an element with no attributes without a stray equals sign', () => {
        const tree = render('<root><child/></root>');

        expect(tree.querySelector(':scope > .xml-tree-attribute')).toBeNull();
        expect(tree.textContent).not.toContain('=');
    });

    test('nested children expand to depth two and collapse below it', () => {
        const tree = render('<a><b><c><d/></c></b></a>');

        const levels = tree.querySelectorAll('.xml-tree-children');
        expect(levels[0].style.display).toBe('block');
        expect(levels[1].style.display).toBe('block');
        expect(levels[2].style.display).toBe('none');
    });

    test('the toggle flips a child list open and shut', () => {
        const tree = render('<root><child/></root>');
        const toggle = tree.querySelector(':scope > .xml-tree-toggle');
        const children = tree.querySelector(':scope > .xml-tree-children');

        expect(children.style.display).toBe('block');
        toggle.click();
        expect(children.style.display).toBe('none');
        expect(toggle.textContent).toBe('▶');
        toggle.click();
        expect(children.style.display).toBe('block');
        expect(toggle.textContent).toBe('▼');
    });

    test('invalid XML renders the error state', () => {
        renderer.render('<root><unclosed></root>', 'xml');

        expect(container.querySelector('.xml-tree')).toBeNull();
        expect(container.querySelector('.preview-error')).not.toBeNull();
    });
});
