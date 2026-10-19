/* global document, DOMParser */
import fs from 'fs';
import { CollectionPalette } from '../../src/modules/ui/runner/CollectionPalette.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const collections = [
    { id: 'c1', name: 'One', endpoints: [{ id: 'e1', name: 'A', method: 'GET', path: '/a' }] },
    { id: 'c2', name: 'Two', endpoints: [{ id: 'e2', name: 'B', method: 'GET', path: '/b' }] }
];

function mount() {
    const html = fs.readFileSync('src/templates/runner/runnerPanel.html', 'utf8');
    templateLoader.cache.set('./src/templates/runner/runnerPanel.html', new DOMParser().parseFromString(html, 'text/html'));
    const onAddEndpoint = jest.fn();
    const onAddAll = jest.fn();
    const palette = new CollectionPalette({ onAddEndpoint, onAddAll });
    const container = document.createElement('div');
    palette.render(container, collections);
    return { palette, container, onAddEndpoint, onAddAll };
}

test('locking to a collection dims the others and blocks their add buttons', () => {
    const { palette, container, onAddEndpoint, onAddAll } = mount();

    palette.setLockedCollection('c1', 'One');

    const other = container.querySelector('[data-collection-id="c2"].runner-collection-item');
    const own = container.querySelector('[data-collection-id="c1"].runner-collection-item');
    expect(other.classList.contains('is-locked')).toBe(true);
    expect(own.classList.contains('is-locked')).toBe(false);
    expect(other.querySelector('[data-action="add-all"]').disabled).toBe(true);
    expect(other.title).toContain('"One"');

    other.querySelector('[data-action="add"]').click();
    other.querySelector('[data-action="add-all"]').click();
    own.querySelector('[data-action="add"]').click();
    expect(onAddAll).not.toHaveBeenCalled();
    expect(onAddEndpoint).toHaveBeenCalledTimes(1);
    expect(onAddEndpoint.mock.calls[0][0].id).toBe('c1');
});

test('the lock survives a re-render and is released with null', () => {
    const { palette, container } = mount();
    palette.setLockedCollection('c1', 'One');

    palette.render(container, collections);
    expect(container.querySelector('[data-collection-id="c2"].runner-collection-item').classList.contains('is-locked')).toBe(true);

    palette.setLockedCollection(null);
    expect(container.querySelectorAll('.is-locked')).toHaveLength(0);
    expect(container.querySelector('[data-collection-id="c2"] [data-action="add-all"]').disabled).toBe(false);
});
