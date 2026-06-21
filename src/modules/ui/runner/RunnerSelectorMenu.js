/**
 * @fileoverview Saved-runner selector dropdown for the Collection Runner: the
 * header toggle, the dropdown list of saved runners, and selection. Tracks which
 * runner is currently active (for highlighting and the delete affordance).
 * @module ui/runner/RunnerSelectorMenu
 */

import { escapeHtml } from './runnerDomUtils.js';

/**
 * Dropdown menu listing saved runners.
 *
 * @class
 */
export class RunnerSelectorMenu {
    /**
     * @param {Object} [callbacks]
     * @param {() => Promise<Array>} [callbacks.onLoadRunners] - Fetches saved runners.
     * @param {(runnerId: string) => void} [callbacks.onSelect] - A runner was chosen.
     */
    constructor({ onLoadRunners, onSelect } = {}) {
        this.dom = {};
        this.currentRunnerId = null;
        this._onLoadRunners = onLoadRunners || null;
        this._onSelect = onSelect || null;
    }

    /**
     * Caches the selector elements from the panel container and wires the toggle
     * button and click-outside-to-close behaviour.
     *
     * @param {HTMLElement} container - The runner panel container
     */
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

        document.addEventListener('click', (e) => {
            if (!this.dom.selector?.contains(e.target) && !this.dom.dropdown?.contains(e.target)) {
                this.close();
            }
        });
    }

    /** Toggles the dropdown open/closed. */
    toggle() {
        if (this.dom.dropdown?.classList.contains('is-hidden')) {
            this.open();
        } else {
            this.close();
        }
    }

    /** Opens the dropdown, (re)loading the saved-runner list. */
    async open() {
        if (!this.dom.dropdown || !this.dom.list) {return;}

        if (this._onLoadRunners) {
            const runners = await this._onLoadRunners();
            this._renderList(runners || []);
        }

        this.dom.dropdown.classList.remove('is-hidden');
    }

    /** Closes the dropdown. */
    close() {
        this.dom.dropdown?.classList.add('is-hidden');
    }

    /**
     * Renders the dropdown list of saved runners.
     *
     * @private
     * @param {Array} runners - List of saved runners
     */
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

    /**
     * Selects a runner from the dropdown.
     *
     * @private
     * @param {string} runnerId - Runner ID to select
     */
    _select(runnerId) {
        this.currentRunnerId = runnerId;
        this._onSelect?.(runnerId);
    }
}
