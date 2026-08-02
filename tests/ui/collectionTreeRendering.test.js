/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';
import { CollectionPalette } from '../../src/modules/ui/runner/CollectionPalette.js';

/**
 * Both the collection tree and the runner palette used to walk the flat
 * `endpoints` array and `folders[].endpoints` separately. The tree took an
 * either/or branch, so a collection holding folders *and* root-level requests
 * rendered only the foldered ones; the palette unioned both lists, so every
 * foldered request appeared twice.
 */
describe('collection tree rendering with folders and root-level requests', () => {
    const mixedCollection = {
        id: 'c1',
        name: 'Mixed',
        endpoints: [
            { id: 'root1', name: 'Health', method: 'GET', protocol: 'http' },
            { id: 'inFolder', name: 'List Pets', method: 'GET', protocol: 'http' }
        ],
        folders: [
            {
                id: 'f1',
                name: 'pets',
                endpoints: [{ id: 'inFolder', name: 'List Pets', method: 'GET', protocol: 'http' }]
            }
        ]
    };

    describe('CollectionRenderer.createEndpointsContainer', () => {
        let renderer;

        beforeEach(() => {
            document.body.innerHTML = '<div id="collections-container"></div>';
            renderer = new CollectionRenderer('collections-container');

            renderer.createEndpointElement = jest.fn(endpoint => {
                const el = document.createElement('div');
                el.dataset.endpointId = endpoint.id;
                return el;
            });
            renderer.createFolderElement = jest.fn(folder => {
                const el = document.createElement('div');
                el.dataset.folderId = folder.id;
                return el;
            });
        });

        test('renders root-level requests even when the collection has folders', () => {
            renderer.createEndpointsContainer(mixedCollection, {});

            const rendered = renderer.createEndpointElement.mock.calls.map(([endpoint]) => endpoint.id);
            expect(rendered).toEqual(['root1']);
        });

        test('renders the folders alongside the root-level requests', () => {
            const container = renderer.createEndpointsContainer(mixedCollection, {});

            expect(Array.from(container.children).map(child => child.dataset.endpointId ?? `folder:${child.dataset.folderId}`))
                .toEqual(['root1', 'folder:f1']);
        });

        test('does not render a foldered request twice', () => {
            renderer.createEndpointsContainer(mixedCollection, {});

            const rendered = renderer.createEndpointElement.mock.calls.map(([endpoint]) => endpoint.id);
            expect(rendered.filter(id => id === 'inFolder')).toHaveLength(0);
        });

        test('a folderless collection still renders its flat list', () => {
            const collection = {
                id: 'c2',
                endpoints: [{ id: 'e1' }, { id: 'e2' }],
                folders: []
            };

            renderer.createEndpointsContainer(collection, {});

            expect(renderer.createEndpointElement.mock.calls.map(([endpoint]) => endpoint.id))
                .toEqual(['e1', 'e2']);
        });
    });

    describe('nested folders', () => {
        const nestedCollection = {
            id: 'c1',
            name: 'Nested',
            endpoints: [
                { id: 'root1', name: 'Health', method: 'GET', protocol: 'http' },
                { id: 'outer1', name: 'List', method: 'GET', protocol: 'http' },
                { id: 'inner1', name: 'Create', method: 'POST', protocol: 'http' }
            ],
            folders: [
                {
                    id: 'outer',
                    name: 'pets',
                    endpoints: [{ id: 'outer1', name: 'List', method: 'GET', protocol: 'http' }],
                    folders: [
                        {
                            id: 'inner',
                            name: 'admin',
                            endpoints: [{ id: 'inner1', name: 'Create', method: 'POST', protocol: 'http' }]
                        }
                    ]
                }
            ]
        };

        let renderer;

        beforeEach(() => {
            document.body.innerHTML = '<div id="collections-container"></div>';
            renderer = new CollectionRenderer('collections-container');
        });

        test('a nested folder renders inside its parent', () => {
            const folderDiv = renderer.createFolderElement(
                nestedCollection.folders[0],
                nestedCollection,
                {}
            );

            const nested = folderDiv.querySelector('.folder-item[data-folder-id="inner"]');
            expect(nested).not.toBeNull();
        });

        test('a request in a nested folder is rendered', () => {
            const folderDiv = renderer.createFolderElement(
                nestedCollection.folders[0],
                nestedCollection,
                {}
            );

            const endpoints = folderDiv.querySelectorAll('[data-endpoint-id]');
            const ids = Array.from(endpoints).map(el => el.dataset.endpointId);
            expect(ids).toEqual(expect.arrayContaining(['outer1', 'inner1']));
        });

        test('a folder with no children still renders its own requests', () => {
            const folderDiv = renderer.createFolderElement(
                { id: 'f1', name: 'flat', endpoints: [{ id: 'e1', name: 'X', method: 'GET' }] },
                nestedCollection,
                {}
            );

            expect(folderDiv.querySelectorAll('[data-endpoint-id]')).toHaveLength(1);
        });

        test('every request is listed exactly once however deep it sits', () => {
            const endpoints = new CollectionPalette()._getAllEndpoints(nestedCollection);
            expect(endpoints.map(e => e.id)).toEqual(['root1', 'outer1', 'inner1']);
        });
    });

    describe('CollectionPalette._getAllEndpoints', () => {
        test('lists each request exactly once', () => {
            const endpoints = new CollectionPalette()._getAllEndpoints(mixedCollection);

            expect(endpoints.map(endpoint => endpoint.id)).toEqual(['root1', 'inFolder']);
        });

        test('still excludes gRPC and WebSocket requests', () => {
            const collection = {
                id: 'c3',
                endpoints: [
                    { id: 'http1', protocol: 'http' },
                    { id: 'grpc1', protocol: 'grpc' },
                    { id: 'ws1', protocol: 'websocket' }
                ],
                folders: []
            };

            const endpoints = new CollectionPalette()._getAllEndpoints(collection);
            expect(endpoints.map(endpoint => endpoint.id)).toEqual(['http1']);
        });
    });
});
