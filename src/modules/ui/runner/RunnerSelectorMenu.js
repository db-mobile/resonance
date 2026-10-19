/**
 * @fileoverview Saved-runner selector dropdown for the Collection Runner: the
 * @module ui/runner/RunnerSelectorMenu
 */

import { escapeHtml } from './runnerDomUtils.js';
import { translate, translateCount } from '../../utils/translate.js';

/**
 * @param {Array<Object>} runners
 * @param {Array<Object>} collections
 * @returns {Array<{collectionId: string, name: string, runners: Array<Object>}>}
 */
export function groupRunnersByCollection(runners, collections) {
    const names = new Map((collections || []).map(collection => [collection.id, collection.name || collection.id]));
    const groups = new Map();
    for (const runner of runners || []) {
        const id = runner.collectionId || '';
        if (!groups.has(id)) {
            groups.set(id, { collectionId: id, name: names.get(id) ?? id, known: names.has(id), runners: [] });
        }
        groups.get(id).runners.push(runner);
    }
    const compare = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    return [...groups.values()]
        .sort((a, b) => (a.known === b.known ? compare(a.name, b.name) : a.known ? -1 : 1))
        .map(({ collectionId, name, runners: list }) => ({
            collectionId,
            name,
            runners: [...list].sort((a, b) => compare(a.name || '', b.name || ''))
        }));
}

export class RunnerSelectorMenu {
    /**
     * @param {Object} [callbacks]
     * @param {() => Promise<Array>} [callbacks.onLoadRunners]
     * @param {(runnerId: string, collectionId: string) => void} [callbacks.onSelect]
     */
    constructor({ onLoadRunners, onSelect } = {}) {
        this.dom = {};
        this.currentRunnerId = null;
        this._onLoadRunners = onLoadRunners || null;
        this._onSelect = onSelect || null;
        this._onDocumentClick = (e) => {
            if (!this.dom.selector?.contains(e.target) && !this.dom.dropdown?.contains(e.target)) {
                this.close();
            }
        };
    }

    /** @param {HTMLElement} container */
    mount(container) {
        this.dom = {
            selector: container.querySelector('[data-role="runner-selector"]'),
            dropdown: container.querySelector('[data-role="runner-dropdown"]'),
            list: container.querySelector('[data-role="runner-list"]')
        };

        container.querySelector('[data-action="toggle-dropdown"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        document.removeEventListener('click', this._onDocumentClick);
        document.addEventListener('click', this._onDocumentClick);
    }

    /** @returns {void} */
    destroy() {
        document.removeEventListener('click', this._onDocumentClick);
        this.dom = {};
    }

    toggle() {
        if (this.dom.dropdown?.classList.contains('is-hidden')) {
            this.open();
        } else {
            this.close();
        }
    }

    async open() {
        if (!this.dom.dropdown || !this.dom.list) {return;}

        if (this._onLoadRunners) {
            const groups = await this._onLoadRunners();
            this._renderList(groups || []);
        }

        this.dom.dropdown.classList.remove('is-hidden');
    }

    close() {
        this.dom.dropdown?.classList.add('is-hidden');
    }

    /** @param {Array<{collectionId: string, name: string, runners: Array<Object>}>} groups */
    _renderList(groups) {
        if (!this.dom.list) {return;}

        if (!groups || groups.length === 0) {
            this.dom.list.innerHTML = `<div class="runner-dropdown-empty dropdown-empty">${escapeHtml(translate('runner.no_saved_runners', 'No saved runners yet'))}</div>`;
            return;
        }

        this.dom.list.innerHTML = groups.map(group => {
            const items = group.runners.map(runner => {
                const requestCount = runner.requests?.length || 0;
                const isSelected = this.currentRunnerId === runner.id;
                return `
                    <div class="runner-dropdown-item dropdown-item u-flex u-items-center u-justify-between ${isSelected ? 'is-selected is-active' : ''}" data-runner-id="${escapeHtml(runner.id)}" data-collection-id="${escapeHtml(group.collectionId)}">
                        <span class="runner-dropdown-item-name dropdown-item-label">${escapeHtml(runner.name)}</span>
                        <span class="dropdown-item-meta">${escapeHtml(translateCount('runner.request_count', requestCount, {
                            one: '{{count}} request',
                            other: '{{count}} requests'
                        }))}</span>
                    </div>
                `;
            }).join('');
            return `<div class="runner-dropdown-group-label" data-collection-id="${escapeHtml(group.collectionId)}">${escapeHtml(group.name)}</div>${items}`;
        }).join('');

        this.dom.list.querySelectorAll('.runner-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                const { runnerId, collectionId } = item.dataset;
                this._select(runnerId, collectionId);
                this.close();
            });
        });
    }

    /**
     * @param {string} runnerId
     * @param {string} collectionId
     */
    _select(runnerId, collectionId) {
        this.currentRunnerId = runnerId;
        this._onSelect?.(runnerId, collectionId);
    }
}
