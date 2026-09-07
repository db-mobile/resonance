/**
 * @fileoverview Saved-runner selector dropdown for the Collection Runner: the
 * @module ui/runner/RunnerSelectorMenu
 */

import { escapeHtml } from './runnerDomUtils.js';

export class RunnerSelectorMenu {
    /**
     * @param {Object} [callbacks]
     * @param {() => Promise<Array>} [callbacks.onLoadRunners]
     * @param {(runnerId: string) => void} [callbacks.onSelect]
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
            const runners = await this._onLoadRunners();
            this._renderList(runners || []);
        }

        this.dom.dropdown.classList.remove('is-hidden');
    }

    close() {
        this.dom.dropdown?.classList.add('is-hidden');
    }

    /** @param {Array} runners */
    _renderList(runners) {
        if (!this.dom.list) {return;}

        if (!runners || runners.length === 0) {
            this.dom.list.innerHTML = '<div class="runner-dropdown-empty dropdown-empty">No saved runners</div>';
            return;
        }

        this.dom.list.innerHTML = runners.map(runner => {
            const requestCount = runner.requests?.length || 0;
            const isSelected = this.currentRunnerId === runner.id;
            return `
                <div class="runner-dropdown-item dropdown-item u-flex u-items-center u-justify-between ${isSelected ? 'is-selected is-active' : ''}" data-runner-id="${runner.id}">
                    <span class="runner-dropdown-item-name dropdown-item-label">${escapeHtml(runner.name)}</span>
                    <span class="dropdown-item-meta">${requestCount} requests</span>
                </div>
            `;
        }).join('');

        this.dom.list.querySelectorAll('.runner-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                const { runnerId } = item.dataset;
                this._select(runnerId);
                this.close();
            });
        });
    }

    /** @param {string} runnerId */
    _select(runnerId) {
        this.currentRunnerId = runnerId;
        this._onSelect?.(runnerId);
    }
}
