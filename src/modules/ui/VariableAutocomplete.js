/**
 * @fileoverview Dropdown completing `{{variable}}` names inside decorated text inputs
 * @module ui/VariableAutocomplete
 */

import { pushEscapeHandler } from './modalEscape.js';
import { isDecorated } from './inputDecorator.js';
import { describeScope, describeValue, scopeBadgeClass } from './variableLabels.js';
import { filterEntries } from '../variables/variableTokens.js';

export { filterEntries };

export const VARIABLE_AUTOCOMPLETE_OPEN_EVENT = 'variable-autocomplete:open';
export const VARIABLE_AUTOCOMPLETE_CLOSE_EVENT = 'variable-autocomplete:close';

const TRIGGER_PATTERN = /\{\{\s*(\$?[A-Za-z0-9_.-]*)$/;
const CLOSING_PATTERN = /^\s*\}\}/;
const MIN_WIDTH = 240;
const MAX_LIST_HEIGHT = 320;
const MIN_LIST_HEIGHT = 120;
const VIEWPORT_MARGIN = 8;

/**
 * @param {string} value
 * @param {number} caret
 * @returns {{start: number, query: string}|null}
 */
export function matchTrigger(value, caret) {
    const match = TRIGGER_PATTERN.exec(value.slice(0, caret));
    if (!match) {
        return null;
    }
    return { start: match.index, query: match[1] };
}

export class VariableAutocomplete {
    /**
     * @param {function(): ({list: function(): Object[]}|null|undefined)} getContext
     * @param {Object} [options]
     * @param {Document|HTMLElement} [options.root]
     */
    constructor(getContext, { root = document } = {}) {
        this.getContext = getContext;
        this.root = root;
        this.dropdown = null;
        this.input = null;
        this.entries = [];
        this.activeIndex = 0;
        this.matchStart = 0;
        this._releaseEscape = null;
        this._blurTimer = null;
        this._onInput = (event) => this._handleInput(event);
        this._onKeydown = (event) => this._handleKeydown(event);
        this._onFocusOut = (event) => this._handleFocusOut(event);
        this._onViewportChange = (event) => this._handleViewportChange(event);
    }

    /** @returns {void} */
    install() {
        this.root.addEventListener('input', this._onInput);
        this.root.addEventListener('keydown', this._onKeydown, true);
        this.root.addEventListener('focusout', this._onFocusOut);
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this._onViewportChange);
            window.addEventListener('scroll', this._onViewportChange, true);
        }
    }

    /** @returns {void} */
    destroy() {
        this._close();
        this.root.removeEventListener('input', this._onInput);
        this.root.removeEventListener('keydown', this._onKeydown, true);
        this.root.removeEventListener('focusout', this._onFocusOut);
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this._onViewportChange);
            window.removeEventListener('scroll', this._onViewportChange, true);
        }
        this.dropdown?.remove();
        this.dropdown = null;
    }

    /** @returns {boolean} */
    isOpen() {
        return this.input !== null;
    }

    /**
     * @param {Event} event
     * @returns {void}
     */
    _handleInput(event) {
        const input = event.target;
        if (!isDecorated(input)) {
            return;
        }
        const match = matchTrigger(input.value, input.selectionStart ?? input.value.length);
        if (!match) {
            if (this.input === input) {
                this._close();
            }
            return;
        }
        const entries = filterEntries(this.getContext()?.list?.() ?? [], match.query);
        if (entries.length === 0) {
            this._close();
            return;
        }
        this._open(input, entries, match.start);
    }

    /**
     * @param {KeyboardEvent} event
     * @returns {void}
     */
    _handleKeydown(event) {
        if (!this.isOpen() || event.target !== this.input) {
            return;
        }
        if (event.key === 'ArrowDown') {
            this._setActive((this.activeIndex + 1) % this.entries.length);
        } else if (event.key === 'ArrowUp') {
            this._setActive((this.activeIndex - 1 + this.entries.length) % this.entries.length);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            this._select(this.entries[this.activeIndex]);
        } else {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    /**
     * @param {Event} [event]
     * @returns {void}
     */
    _handleViewportChange(event) {
        if (event?.type === 'scroll' && this.dropdown && event.target instanceof Node && this.dropdown.contains(event.target)) {
            return;
        }
        this._close();
    }

    /**
     * @param {FocusEvent} event
     * @returns {void}
     */
    _handleFocusOut(event) {
        if (event.target !== this.input) {
            return;
        }
        clearTimeout(this._blurTimer);
        this._blurTimer = setTimeout(() => this._close(), 150);
    }

    /**
     * @param {HTMLInputElement} input
     * @param {Object[]} entries
     * @param {number} matchStart
     * @returns {void}
     */
    _open(input, entries, matchStart) {
        clearTimeout(this._blurTimer);
        const switching = this.input !== input;
        if (switching && this.input) {
            this._markClosed(this.input);
        }
        this.input = input;
        this.entries = entries;
        this.matchStart = matchStart;
        this.activeIndex = 0;
        this._render();
        this._position();
        if (switching || input.dataset.varCompleting !== 'true') {
            input.dataset.varCompleting = 'true';
            input.dispatchEvent(new CustomEvent(VARIABLE_AUTOCOMPLETE_OPEN_EVENT, { bubbles: true }));
        }
        if (!this._releaseEscape) {
            this._releaseEscape = pushEscapeHandler(() => this._close());
        }
    }

    /** @returns {HTMLElement} */
    _ensureDropdown() {
        if (!this.dropdown) {
            this.dropdown = document.createElement('ul');
            this.dropdown.className = 'variable-autocomplete';
            this.dropdown.setAttribute('role', 'listbox');
            this.dropdown.addEventListener('mousedown', (event) => event.preventDefault());
            document.body.appendChild(this.dropdown);
        }
        return this.dropdown;
    }

    /** @returns {void} */
    _render() {
        const dropdown = this._ensureDropdown();
        dropdown.replaceChildren();
        this.entries.forEach((entry, index) => {
            const item = document.createElement('li');
            item.className = 'variable-autocomplete-item';
            item.setAttribute('role', 'option');

            const name = document.createElement('span');
            name.className = 'variable-autocomplete-name';
            name.textContent = entry.name;

            const scope = document.createElement('span');
            scope.className = `badge ${scopeBadgeClass(entry)} variable-autocomplete-scope`;
            scope.textContent = describeScope(entry);

            const value = document.createElement('span');
            value.className = 'variable-autocomplete-value';
            value.textContent = describeValue(entry);

            item.append(name, scope, value);
            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
                this._select(entry);
            });
            item.addEventListener('mouseover', () => this._setActive(index));
            dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
        this._setActive(this.activeIndex);
    }

    /** @returns {void} */
    _position() {
        if (!this.dropdown || !this.input) {
            return;
        }
        const rect = this.input.getBoundingClientRect();
        const { style } = this.dropdown;
        style.left = `${Math.round(rect.left)}px`;
        style.width = `${Math.round(Math.max(rect.width, MIN_WIDTH))}px`;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
        const spaceBelow = viewportHeight ? viewportHeight - rect.bottom - 3 - VIEWPORT_MARGIN : Infinity;
        const spaceAbove = viewportHeight ? rect.top - 3 - VIEWPORT_MARGIN : Infinity;
        if (viewportHeight && spaceBelow < MIN_LIST_HEIGHT && spaceAbove > spaceBelow) {
            style.top = '';
            style.bottom = `${Math.round(viewportHeight - rect.top + 3)}px`;
            style.maxHeight = `${Math.round(Math.min(MAX_LIST_HEIGHT, spaceAbove))}px`;
        } else {
            style.bottom = '';
            style.top = `${Math.round(rect.bottom + 3)}px`;
            style.maxHeight = `${Math.round(Math.min(MAX_LIST_HEIGHT, spaceBelow))}px`;
        }
    }

    /**
     * @param {number} index
     * @returns {void}
     */
    _setActive(index) {
        this.activeIndex = index;
        this.dropdown?.querySelectorAll('.variable-autocomplete-item').forEach((item, i) => {
            item.classList.toggle('active', i === index);
            item.setAttribute('aria-selected', i === index ? 'true' : 'false');
        });
    }

    /**
     * @param {Object} entry
     * @returns {void}
     */
    _select(entry) {
        const { input } = this;
        if (!input || !entry) {
            this._close();
            return;
        }
        const { value } = input;
        const caret = input.selectionStart ?? value.length;
        const after = value.slice(caret);
        const closing = CLOSING_PATTERN.exec(after);
        const inserted = `{{${entry.name}${closing ? '' : '}}'}`;
        const position = this.matchStart + inserted.length + (closing ? closing[0].length : 0);
        input.value = value.slice(0, this.matchStart) + inserted + after;
        input.setSelectionRange(position, position);
        this._close();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }

    /**
     * @param {HTMLInputElement} input
     * @returns {void}
     */
    _markClosed(input) {
        delete input.dataset.varCompleting;
        input.dispatchEvent(new CustomEvent(VARIABLE_AUTOCOMPLETE_CLOSE_EVENT, { bubbles: true }));
    }

    /** @returns {void} */
    _close() {
        clearTimeout(this._blurTimer);
        this._blurTimer = null;
        if (this.dropdown) {
            this.dropdown.classList.remove('visible');
            this.dropdown.replaceChildren();
        }
        if (this.input) {
            this._markClosed(this.input);
        }
        this.input = null;
        this.entries = [];
        this.activeIndex = 0;
        if (this._releaseEscape) {
            this._releaseEscape();
            this._releaseEscape = null;
        }
    }
}
