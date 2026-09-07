/**
 * @fileoverview Request queue for the Collection Runner: the ordered list of
 * @module ui/runner/RequestQueue
 */

import { templateLoader } from '../../templateLoader.js';

export class RequestQueue {
    /**
     * @param {Object} [callbacks]
     * @param {() => void} [callbacks.onChange]
     * @param {(count: number) => void} [callbacks.onCountChange]
     * @param {(index: number) => void} [callbacks.onEditRequest]
     * @param {(collectionId: string, endpointId: string) => Promise<Object>} [callbacks.onResolveEndpointDefaults]
     */
    constructor({ onChange, onCountChange, onEditRequest, onResolveEndpointDefaults } = {}) {
        this.container = null;
        this.requests = [];
        this.selectedIndex = -1;

        this._onChange = onChange || null;
        this._onCountChange = onCountChange || null;
        this._onEditRequest = onEditRequest || null;
        this._onResolveEndpointDefaults = onResolveEndpointDefaults || null;
    }

    /** @param {HTMLElement} container */
    mount(container) {
        this.container = container;
        this._render();
    }

    /** @returns {number} */
    get count() {
        return this.requests.length;
    }

    /** @returns {Array<Object>} */
    getRequests() {
        return this.requests;
    }

    /** @param {Array<Object>} requests */
    setRequests(requests) {
        this.requests = requests ? [...requests] : [];
        this.selectedIndex = -1;
        this._render();
    }

    reset() {
        this.requests = [];
        this.selectedIndex = -1;
        this._render();
    }

    clearAll() {
        this.reset();
        this._emitChange();
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     */
    async addRequest(collection, endpoint) {
        const request = {
            collectionId: collection.id,
            endpointId: endpoint.id,
            name: endpoint.name || endpoint.path,
            method: endpoint.method,
            path: endpoint.path,
            postResponseScript: '',
            overrides: await this._resolveOverrides(collection.id, endpoint.id)
        };

        this.requests.push(request);
        this._render();
        this._emitChange();
    }

    _emitChange() {
        this._onChange?.();
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object>}
     */
    async _resolveOverrides(collectionId, endpointId) {
        const empty = { pathParams: [], queryParams: [], headers: [], body: '' };

        if (!this._onResolveEndpointDefaults) {
            return empty;
        }

        try {
            const config = await this._onResolveEndpointDefaults(collectionId, endpointId);
            return {
                pathParams: (config?.pathParams || []).map(p => ({ key: p.key, value: p.value })),
                queryParams: (config?.queryParams || [])
                    .filter(p => p.enabled !== false)
                    .map(p => ({ key: p.key, value: p.value })),
                headers: (config?.headers || [])
                    .filter(p => p.enabled !== false)
                    .map(p => ({ key: p.key, value: p.value })),
                body: config?.body || ''
            };
        } catch (error) {
            console.error('[RequestQueue] Error resolving endpoint defaults:', error);
            return empty;
        }
    }

    _render() {
        if (!this.container) {return;}

        if (this.requests.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state-base runner-empty-state">
                    <span class="icon icon-20 icon-plus"></span>
                    <p>Click requests from the left panel to add them</p>
                </div>
            `;
        } else {
            this.container.innerHTML = '';
            this.requests.forEach((request, index) => {
                this.container.appendChild(this._createItem(request, index));
            });
            this._setupDragAndDrop();
        }

        this._onCountChange?.(this.count);
    }

    /**
     * @param {Object} request
     * @param {number} index
     * @returns {HTMLElement}
     */
    _createItem(request, index) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-request-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.index = index;

        if (index === this.selectedIndex) {
            el.classList.add('is-selected');
        }

        const methodEl = el.querySelector('[data-role="method"]');
        if (methodEl) {
            methodEl.textContent = request.method;
            methodEl.dataset.method = request.method;
        }

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {
            nameEl.textContent = request.name;
        }

        el.querySelector('[data-action="edit-script"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._select(index);
        });

        el.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._remove(index);
        });

        el.addEventListener('click', () => {
            this._select(index);
        });

        return el;
    }

    _setupDragAndDrop() {
        const items = this.container.querySelectorAll('.runner-request-item');

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('is-dragging');
                e.dataTransfer.setData('text/plain', item.dataset.index);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('is-dragging');
                this._reorderFromDOM();
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = this.container.querySelector('.is-dragging');
                if (dragging && dragging !== item) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        item.parentNode.insertBefore(dragging, item);
                    } else {
                        item.parentNode.insertBefore(dragging, item.nextSibling);
                    }
                }
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                this._reorderFromDOM();
            });
        });
    }

    _reorderFromDOM() {
        const items = this.container.querySelectorAll('.runner-request-item');
        const newOrder = [];

        items.forEach(item => {
            const index = parseInt(item.dataset.index, 10);
            newOrder.push(this.requests[index]);
        });

        if (newOrder.length === this.requests.length &&
            newOrder.every((request, index) => request === this.requests[index])) {
            return;
        }

        this.requests = newOrder;
        this._render();
        this._emitChange();
    }

    /** @param {number} index */
    _select(index) {
        this.selectedIndex = index;
        this._render();
        this._onEditRequest?.(index);
    }

    /** @param {number} index */
    _remove(index) {
        this.requests.splice(index, 1);

        if (this.selectedIndex === index) {
            this.selectedIndex = -1;
        } else if (this.selectedIndex > index) {
            this.selectedIndex--;
        }

        this._render();
        this._emitChange();
    }
}
