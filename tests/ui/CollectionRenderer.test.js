import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

const { document } = globalThis;

describe('CollectionRenderer optional request metadata', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="collections-list"></div>';
    });

    test('a request without method or path does not blank the collection sidebar', async () => {
        const renderer = new CollectionRenderer('collections-list');
        await renderer.renderCollections([
            { id: 'c1', name: 'First', endpoints: [{ id: 'minimal', name: 'Minimal' }] },
            { id: 'c2', name: 'Second', endpoints: [{ id: 'health', method: 'GET', path: '/health' }] }
        ]);

        expect(document.querySelectorAll('.collection-item')).toHaveLength(2);
        expect(document.querySelector('[data-endpoint-id="minimal"] .method-pill').textContent).toBe('GET');
        expect(document.querySelector('[data-endpoint-id="health"] .endpoint-path').textContent).toBe('/health');
    });

    test('uses protocol labels and a name fallback for incomplete requests', () => {
        const renderer = new CollectionRenderer('collections-list');
        const row = renderer.createEndpointElement({ id: 'gql', protocol: 'graphql' }, { id: 'c1' }, {});
        expect(row.querySelector('.method-pill').textContent).toBe('GQL');
        expect(row.querySelector('.endpoint-path').textContent).toBe('Unnamed Request');
    });
});
