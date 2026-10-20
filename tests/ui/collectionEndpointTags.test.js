/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

describe('sidebar request tag chips', () => {
    let renderer;
    const collection = { id: 'c1', name: 'Petstore' };
    const row = (endpoint) => renderer.createEndpointElement(endpoint, collection, {});
    const chips = (element) => [...element.querySelectorAll('.endpoint-tag')].map(chip => chip.textContent);

    beforeEach(() => {
        document.body.innerHTML = '<div id="collections-container"></div>';
        renderer = new CollectionRenderer('collections-container');
    });

    test('renders one chip per tag between the name and the pin button', () => {
        const element = row({ id: 'e1', name: 'List', method: 'GET', tags: ['smoke', 'Pets'] });

        expect(chips(element)).toEqual(['smoke', 'Pets']);
        expect(element.querySelector('.endpoint-tags').title).toBe('smoke, Pets');
        const children = [...element.children].map(child => child.className.split(' ')[0]);
        expect(children).toEqual(['method-pill', 'endpoint-path', 'endpoint-tags', 'icon']);
    });

    test('renders no container for an untagged request', () => {
        expect(row({ id: 'e1', name: 'List', method: 'GET' }).querySelector('.endpoint-tags')).toBeNull();
        expect(row({ id: 'e1', name: 'List', method: 'GET', tags: [' ', ''] }).querySelector('.endpoint-tags')).toBeNull();
    });

    test('collapses more than two tags into a +N chip that still lists them all in the tooltip', () => {
        const element = row({ id: 'e1', name: 'List', method: 'GET', tags: ['a', 'b', 'c', 'd', 'e'] });

        expect(chips(element)).toEqual(['a', 'b', '+3']);
        expect(element.querySelector('.endpoint-tag-more').textContent).toBe('+3');
        expect(element.querySelector('.endpoint-tags').title).toBe('a, b, c, d, e');
    });
});
