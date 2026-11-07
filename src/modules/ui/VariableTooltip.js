/**
 * @fileoverview Tooltip describing a `{{variable}}` token: name, scope and (masked) value
 * @module ui/VariableTooltip
 */

import { SECRET_MASK } from '../variables/variableTokens.js';
import { describeScope, scopeBadgeClass, translateLabel } from './variableLabels.js';

const MAX_VALUE_LENGTH = 240;

/**
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

/**
 * @param {Object} entry
 * @returns {HTMLElement}
 */
function renderBody(entry) {
    switch (entry.status) {
        case 'dynamic': {
            const body = el('div', 'var-tooltip-body');
            body.appendChild(el('span', 'var-tooltip-description', entry.description ?? ''));
            if (entry.example) {
                body.appendChild(el('code', 'var-tooltip-example', entry.example));
            }
            return body;
        }
        case 'unknown':
            return el('div', 'var-tooltip-missing', translateLabel('variables.tooltip.loading', 'Variables not loaded yet'));
        case 'resolved':
        case 'path-param': {
            const body = el('div', 'var-tooltip-body');
            if (entry.secret) {
                body.appendChild(el('span', 'var-tooltip-value', SECRET_MASK));
                body.appendChild(el('span', 'badge warning var-tooltip-secret', translateLabel('variables.tooltip.secret', 'secret')));
                return body;
            }
            const value = entry.value ?? '';
            const shown = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;
            body.appendChild(el('span', `var-tooltip-value${shown === '' ? ' is-empty' : ''}`,
                shown === '' ? translateLabel('variables.tooltip.empty', '(empty)') : shown));
            return body;
        }
        default:
            return el('div', 'var-tooltip-missing',
                translateLabel('variables.tooltip.missing', 'Not defined in current environment or collection'));
    }
}

/**
 * @param {Object} entry
 * @returns {HTMLElement}
 */
export function renderVariableTooltip(entry) {
    const root = el('div', `var-tooltip var-tooltip--${entry?.status ?? 'unresolved'}`);
    const header = el('div', 'var-tooltip-header');
    header.appendChild(el('span', 'var-tooltip-name', entry?.name ?? ''));
    header.appendChild(el('span', `badge ${scopeBadgeClass(entry)} var-tooltip-scope`, describeScope(entry)));
    root.appendChild(header);
    root.appendChild(renderBody(entry ?? { status: 'unresolved' }));
    return root;
}

const HOVER_OFFSET = 6;

export class VariableTooltip {
    /**
     * @param {function(string, HTMLInputElement): Object} lookup
     * @param {Object} [options]
     * @param {Document|HTMLElement} [options.root]
     * @param {function(HTMLInputElement): boolean} [options.isTarget]
     */
    constructor(lookup, { root = document, isTarget = () => true } = {}) {
        this.lookup = lookup;
        this.root = root;
        this.isTarget = isTarget;
        this.element = null;
        this.current = null;
        this._raf = 0;
        this._pending = null;
        this._onMove = (event) => this._queue(event);
        this._onLeave = (event) => this._handleLeave(event);
        this._onHide = () => this.hide();
    }

    /** @returns {void} */
    install() {
        this.root.addEventListener('mousemove', this._onMove);
        this.root.addEventListener('mouseout', this._onLeave);
        this.root.addEventListener('keydown', this._onHide, true);
        this.root.addEventListener('focusout', this._onHide);
        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', this._onHide, true);
            window.addEventListener('resize', this._onHide);
        }
    }

    /** @returns {void} */
    destroy() {
        this.hide();
        this.root.removeEventListener('mousemove', this._onMove);
        this.root.removeEventListener('mouseout', this._onLeave);
        this.root.removeEventListener('keydown', this._onHide, true);
        this.root.removeEventListener('focusout', this._onHide);
        if (typeof window !== 'undefined') {
            window.removeEventListener('scroll', this._onHide, true);
            window.removeEventListener('resize', this._onHide);
        }
        this.element?.remove();
        this.element = null;
    }

    /** @returns {boolean} */
    isVisible() {
        return Boolean(this.element) && !this.element.hidden;
    }

    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    _queue(event) {
        this._pending = event;
        if (this._raf) {
            return;
        }
        const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
        this._raf = schedule(() => {
            this._raf = 0;
            this._handleMove(this._pending);
        });
    }

    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    _handleMove(event) {
        const input = event?.target;
        if (!input || input.tagName !== 'INPUT' || !this.isTarget(input)) {
            this.hide();
            return;
        }
        const hit = this._hitTest(input, event.clientX, event.clientY);
        if (!hit) {
            this.hide();
            return;
        }
        if (this.current && this.current.input === input && this.current.token === hit.token) {
            return;
        }
        this.current = { input, token: hit.token };
        this.showAt(hit.rect, this.lookup(hit.token.dataset.var, input));
    }

    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    _handleLeave(event) {
        if (this.current && event.target === this.current.input) {
            this.hide();
        }
    }

    /**
     * @param {HTMLInputElement} input
     * @param {number} x
     * @param {number} y
     * @returns {{token: HTMLElement, rect: DOMRect}|null}
     */
    _hitTest(input, x, y) {
        const field = input.parentElement;
        const tokens = field?.classList?.contains('var-field') ? field.querySelectorAll('.var-field-mirror .var-token') : [];
        for (const token of tokens) {
            const rect = token.getBoundingClientRect();
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return { token, rect };
            }
        }
        return null;
    }

    /** @returns {HTMLElement} */
    _ensureElement() {
        if (!this.element) {
            this.element = document.createElement('div');
            this.element.className = 'var-tooltip-floating';
            this.element.setAttribute('role', 'tooltip');
            this.element.hidden = true;
            document.body.appendChild(this.element);
        }
        return this.element;
    }

    /**
     * @param {{left: number, top: number, bottom: number, width: number}} rect
     * @param {Object} entry
     * @returns {void}
     */
    showAt(rect, entry) {
        const element = this._ensureElement();
        element.replaceChildren(renderVariableTooltip(entry));
        element.hidden = false;
        const height = element.offsetHeight || 0;
        const width = element.offsetWidth || 0;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
        let left = Math.round(rect.left);
        if (viewportWidth && width && left + width > viewportWidth - HOVER_OFFSET) {
            left = Math.max(HOVER_OFFSET, viewportWidth - width - HOVER_OFFSET);
        }
        const above = rect.top - height - HOVER_OFFSET;
        element.style.left = `${left}px`;
        element.style.top = `${Math.round(above >= 0 ? above : rect.bottom + HOVER_OFFSET)}px`;
    }

    /** @returns {void} */
    hide() {
        this.current = null;
        if (this.element) {
            this.element.hidden = true;
        }
    }
}
