/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

/**
 * Toggling a pin used to reload every collection from disk and rebuild the
 * whole sidebar. The pin state is now patched in place: the row's button flips
 * and only the pinned section is regenerated.
 */
describe('collection pin in-place patch', () => {
    let renderer;
    const collections = [{
        id: 'c1',
        name: 'API',
        endpoints: [
            { id: 'e1', name: 'List users', method: 'GET', path: '/users' },
            { id: 'e2', name: 'Create user', method: 'POST', path: '/users' }
        ],
        folders: []
    }];

    beforeEach(async () => {
        document.body.innerHTML = '<div id="collections-container"></div>';
        renderer = new CollectionRenderer('collections-container');
        await renderer.renderCollections(collections, {}, false, {}, {});
    });

    const pinBtn = (endpointId) =>
        document.querySelector(`.collection-item .endpoint-item[data-endpoint-id="${endpointId}"] .endpoint-pin-btn`);

    test('pinning flips the row button and creates the pinned section without a rebuild', () => {
        const rowBefore = document.querySelector('.collection-item .endpoint-item[data-endpoint-id="e1"]');

        renderer.updatePinnedState('c1', 'e1', true, { c1_e1: true });

        expect(pinBtn('e1').classList.contains('is-pinned')).toBe(true);
        expect(pinBtn('e1').title).toBe('Unpin request');
        expect(document.querySelector('.pinned-section')).not.toBeNull();
        expect(document.querySelector('.collection-item .endpoint-item[data-endpoint-id="e1"]')).toBe(rowBefore);
    });

    test('unpinning removes the pinned section again', () => {
        renderer.updatePinnedState('c1', 'e1', true, { c1_e1: true });
        renderer.updatePinnedState('c1', 'e1', false, {});

        expect(document.querySelector('.pinned-section')).toBeNull();
        expect(pinBtn('e1').classList.contains('is-pinned')).toBe(false);
    });
});
