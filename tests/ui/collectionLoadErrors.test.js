/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

describe('collection load error rows', () => {
    let renderer;
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<div id="collections-container"><div class="collection-item"></div></div>';
        container = document.getElementById('collections-container');
        renderer = new CollectionRenderer('collections-container');
    });

    test('renders one row per error with folder name and message, after the collections', () => {
        renderer.renderLoadErrors([
            { path: '/home/u/api/payments', id: null, message: 'Invalid variables.yaml' },
            { path: 'C:\\work\\orders', id: 'c2', message: 'Collection folder not found' }
        ]);

        const rows = container.querySelectorAll('.collection-load-error');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.collection-load-error-name').textContent).toBe('payments');
        expect(rows[0].querySelector('.collection-load-error-message').textContent).toBe('Invalid variables.yaml');
        expect(rows[1].querySelector('.collection-load-error-name').textContent).toBe('orders');
        expect(rows[0].title).toContain('/home/u/api/payments');
        expect(container.lastElementChild.classList.contains('collection-load-errors')).toBe(true);
    });

    test('re-rendering replaces the previous rows instead of stacking them', () => {
        renderer.renderLoadErrors([{ path: '/a', id: null, message: 'x' }]);
        renderer.renderLoadErrors([{ path: '/b', id: null, message: 'y' }]);

        expect(container.querySelectorAll('.collection-load-errors')).toHaveLength(1);
        expect(container.querySelector('.collection-load-error-name').textContent).toBe('b');
    });

    test('an empty list removes the rows', () => {
        renderer.renderLoadErrors([{ path: '/a', id: null, message: 'x' }]);
        renderer.renderLoadErrors([]);

        expect(container.querySelector('.collection-load-errors')).toBeNull();
    });
});
