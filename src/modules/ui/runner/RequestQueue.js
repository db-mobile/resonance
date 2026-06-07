/**
 * @fileoverview Request queue for the Collection Runner: the ordered list of
 * selected requests, with drag-and-drop reordering, removal, and per-row edit
 * triggers. Owns the `requests` array and the current selection highlight.
 * @module ui/runner/RequestQueue
 */

import { templateLoader } from '../../templateLoader.js';

/**
 * Manages the selected-requests list for a runner.
 *
 * Distinguishes user-driven mutations (add/remove/reorder/clear-all), which fire
 * `onChange`, from lifecycle resets (`setRequests`/`reset`), which do not. The
 * count callback fires on every render so the host's counter stays in sync.
 *
 * @class
 */
export class RequestQueue {
    /**
     * @param {Object} [callbacks]
     * @param {() => void} [callbacks.onChange] - User changed the request list.
     * @param {(count: number) => void} [callbacks.onCountChange] - List re-rendered.
     * @param {(index: number) => void} [callbacks.onEditRequest] - Edit a request.
     * @param {(collectionId: string, endpointId: string) => Promise<Object>} [callbacks.onResolveEndpointDefaults]
     *   Resolves a collection's saved config to seed a new request's overrides.
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

    /**
     * Binds the list container and performs the initial render.
     *
     * @param {HTMLElement} container - The requests-list element
     */
    mount(container) {
        this.container = container;
        this._render();
    }

    /** @returns {number} number of queued requests */
    get count() {
        return this.requests.length;
    }

    /** @returns {Array<Object>} the live requests array */
    getRequests() {
        return this.requests;
    }

    /**
     * Replaces the queued requests (e.g. when loading a saved runner). Silent —
     * does not fire `onChange`.
     *
     * @param {Array<Object>} requests
     */
    setRequests(requests) {
        this.requests = requests ? [...requests] : [];
        this.selectedIndex = -1;
        this._render();
    }

    /**
     * Empties the queue without notifying listeners (used by reset/new-runner).
     */
    reset() {
        this.requests = [];
        this.selectedIndex = -1;
        this._render();
    }

    /**
     * Empties the queue as a user action, firing `onChange`.
     */
    clearAll() {
        this.reset();
        this._emitChange();
    }

    /**
     * Adds a request from a collection endpoint, seeding its overrides from the
     * collection's saved config so the editor opens pre-filled.
     *
     * @param {Object} collection - Collection object
     * @param {Object} endpoint - Endpoint object
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
     * Resolves the initial overrides for a request from the collection's saved config.
     *
     * @private
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object>} Overrides object
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
                queryParams: (config?.queryParams || []).map(p => ({ key: p.key, value: p.value })),
                headers: (config?.headers || []).map(p => ({ key: p.key, value: p.value })),
                body: config?.body || ''
            };
        } catch (error) {
            console.error('[RequestQueue] Error resolving endpoint defaults:', error);
            return empty;
        }
    }

    /**
     * Renders the selected requests list.
     *
     * @private
     */
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
     * Creates a request item element.
     *
     * @private
     * @param {Object} request - Request object
     * @param {number} index - Request index
     * @returns {HTMLElement} Request item element
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

        // Edit script button
        el.querySelector('[data-action="edit-script"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._select(index);
        });

        // Remove button
        el.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._remove(index);
        });

        // Click to select
        el.addEventListener('click', () => {
            this._select(index);
        });

        return el;
    }

    /**
     * Sets up drag and drop for request reordering.
     *
     * @private
     */
    _setupDragAndDrop() {
        const items = this.container.querySelectorAll('.runner-request-item');

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('is-dragging');
                e.dataTransfer.setData('text/plain', item.dataset.index);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('is-dragging');
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

    /**
     * Reorders requests based on current DOM order.
     *
     * @private
     */
    _reorderFromDOM() {
        const items = this.container.querySelectorAll('.runner-request-item');
        const newOrder = [];

        items.forEach(item => {
            const index = parseInt(item.dataset.index, 10);
            newOrder.push(this.requests[index]);
        });

        this.requests = newOrder;
        this._render();
        this._emitChange();
    }

    /**
     * Selects a request for script editing (highlights it and requests an edit).
     *
     * @private
     * @param {number} index - Request index
     */
    _select(index) {
        this.selectedIndex = index;
        this._render();
        this._onEditRequest?.(index);
    }

    /**
     * Removes a request from the list.
     *
     * @private
     * @param {number} index - Request index
     */
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
