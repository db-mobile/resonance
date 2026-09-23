/**
 * @fileoverview Collection palette for the Collection Runner: the left-hand tree
 * @module ui/runner/CollectionPalette
 */

import { templateLoader } from '../../templateLoader.js';
import { flattenRequests } from '../../collections/collectionTree.js';
import { isRunnable } from '../../utils/runnableRequests.js';
import { translate } from '../../utils/translate.js';
import { escapeHtml } from './runnerDomUtils.js';

export class CollectionPalette {
    /**
     * @param {Object} [callbacks]
     * @param {(collection: Object, endpoint: Object) => void} [callbacks.onAddEndpoint]
     * @param {(collection: Object, endpoints: Object[]) => void} [callbacks.onAddAll]
     */
    constructor({ onAddEndpoint, onAddAll } = {}) {
        this.container = null;
        this._onAddEndpoint = onAddEndpoint || null;
        this._onAddAll = onAddAll || null;
    }

    /**
     * @param {HTMLElement} container
     * @param {Array<Object>} collections
     */
    render(container, collections) {
        this.container = container;
        if (!this.container) {return;}

        if (!collections || collections.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state-base runner-empty-state">
                    <span class="icon icon-20 icon-spark"></span>
                    <p>${escapeHtml(translate('runner.no_collections', 'No collections available'))}</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = '';

        collections.forEach(collection => {
            const endpoints = this._getAllEndpoints(collection);
            if (endpoints.length === 0) {return;}

            this.container.appendChild(this._createCollectionElement(collection));
        });
    }

    /**
     * @param {Object} collection
     * @returns {HTMLElement}
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

        headerEl?.addEventListener('click', () => {
            el.classList.toggle('is-expanded');
            endpointsContainer?.classList.toggle('is-hidden');
        });

        const endpoints = this._getAllEndpoints(collection);

        el.querySelector('[data-action="add-all"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onAddAll?.(collection, endpoints);
        });

        if (endpointsContainer) {
            endpoints.forEach(endpoint => {
                const endpointEl = this._createEndpointElement(collection, endpoint);
                endpointsContainer.appendChild(endpointEl);
            });
        }

        return el;
    }

    /**
     * @param {Object} collection
     * @returns {Array<Object>}
     */
    _getAllEndpoints(collection) {
        return flattenRequests(collection).filter(isRunnable);
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @returns {HTMLElement}
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

        const addBtn = el.querySelector('[data-action="add"]');
        addBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onAddEndpoint?.(collection, endpoint);
        });

        el.addEventListener('click', () => {
            this._onAddEndpoint?.(collection, endpoint);
        });

        return el;
    }
}
