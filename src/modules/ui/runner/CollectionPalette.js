/**
 * @fileoverview Collection palette for the Collection Runner: the left-hand tree
 * of collections and their HTTP endpoints. Clicking an endpoint emits an "add"
 * event; the palette holds no selection state of its own.
 * @module ui/runner/CollectionPalette
 */

import { templateLoader } from '../../templateLoader.js';

/**
 * Renders the collection/endpoint source tree and reports endpoint adds.
 *
 * @class
 */
export class CollectionPalette {
    /**
     * @param {Object} [callbacks]
     * @param {(collection: Object, endpoint: Object) => void} [callbacks.onAddEndpoint]
     *   Invoked when the user adds an endpoint (via the add button or item click).
     */
    constructor({ onAddEndpoint } = {}) {
        this.container = null;
        this._onAddEndpoint = onAddEndpoint || null;
    }

    /**
     * Renders the collection tree into the given container.
     *
     * @param {HTMLElement} container - Tree container element
     * @param {Array<Object>} collections - Available collections
     */
    render(container, collections) {
        this.container = container;
        if (!this.container) {return;}

        if (!collections || collections.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state-base runner-empty-state">
                    <span class="icon icon-20 icon-spark"></span>
                    <p>No collections available</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = '';

        collections.forEach(collection => {
            // Skip collections with no HTTP endpoints
            const endpoints = this._getAllEndpoints(collection);
            if (endpoints.length === 0) {return;}

            this.container.appendChild(this._createCollectionElement(collection));
        });
    }

    /**
     * Creates a collection element for the tree.
     *
     * @private
     * @param {Object} collection - Collection object
     * @returns {HTMLElement} Collection element
     */
    _createCollectionElement(collection) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-collection-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.collectionId = collection.id;

        const nameEl = el.querySelector('[data-role="collection-name"]');
        if (nameEl) {nameEl.textContent = collection.name;}

        const headerEl = el.querySelector('[data-role="collection-header"]');
        const endpointsContainer = el.querySelector('[data-role="endpoints-container"]');

        // Toggle expansion
        headerEl?.addEventListener('click', () => {
            el.classList.toggle('is-expanded');
            endpointsContainer?.classList.toggle('is-hidden');
        });

        // Render endpoints
        if (endpointsContainer) {
            const endpoints = this._getAllEndpoints(collection);
            endpoints.forEach(endpoint => {
                const endpointEl = this._createEndpointElement(collection, endpoint);
                endpointsContainer.appendChild(endpointEl);
            });
        }

        return el;
    }

    /**
     * Gets all HTTP endpoints from a collection (including folders), excluding gRPC.
     *
     * @private
     * @param {Object} collection - Collection object
     * @returns {Array<Object>} Array of HTTP endpoints
     */
    _getAllEndpoints(collection) {
        const endpoints = [];

        const isHttp = e => e.protocol !== 'grpc' && e.protocol !== 'websocket';

        if (collection.endpoints) {
            endpoints.push(...collection.endpoints.filter(isHttp));
        }

        if (collection.folders) {
            collection.folders.forEach(folder => {
                if (folder.endpoints) {
                    endpoints.push(...folder.endpoints.filter(isHttp));
                }
            });
        }

        return endpoints;
    }

    /**
     * Creates an endpoint element for the tree.
     *
     * @private
     * @param {Object} collection - Parent collection
     * @param {Object} endpoint - Endpoint object
     * @returns {HTMLElement} Endpoint element
     */
    _createEndpointElement(collection, endpoint) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-endpoint-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.collectionId = collection.id;
        el.dataset.endpointId = endpoint.id;

        const methodEl = el.querySelector('[data-role="method"]');
        if (methodEl) {
            methodEl.textContent = endpoint.method;
            methodEl.dataset.method = endpoint.method;
        }

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {
            nameEl.textContent = endpoint.name || endpoint.path;
        }

        // Add button click
        const addBtn = el.querySelector('[data-action="add"]');
        addBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onAddEndpoint?.(collection, endpoint);
        });

        // Click on item also adds
        el.addEventListener('click', () => {
            this._onAddEndpoint?.(collection, endpoint);
        });

        return el;
    }
}
