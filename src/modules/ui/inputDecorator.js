/**
 * @fileoverview Mirror overlay that paints `{{variable}}` tokens as pills behind plain text inputs
 * @module ui/inputDecorator
 * @typedef {Object} InputDecoration
 * @property {HTMLInputElement} input
 * @property {HTMLElement} wrapper
 * @property {HTMLElement} mirror
 * @property {HTMLElement} text
 * @property {boolean} url
 * @property {boolean} hasTokens
 * @property {string|null} lastValue
 * @property {boolean} metricsCopied
 * @property {number} raf
 */

import { tokenize } from '../variables/variableTokens.js';

export const FORM_RESTORED_EVENT = 'resonance:request-form-restored';
export const THEME_CHANGED_EVENT = 'resonance:theme-changed';

const DECORATABLE_TYPES = new Set(['text', 'url', 'search']);
const DECORATABLE_SELECTOR = 'input.key-input, input.value-input, input.file-path-input, input.part-content-type-input';
const STATUS_CLASSES = new Set(['resolved', 'unresolved', 'dynamic', 'path-param', 'unknown']);
const COPIED_STYLES = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing', 'lineHeight',
    'textIndent', 'textTransform', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'marginLeft', 'marginRight'
];
const SYNC_EVENTS = ['scroll', 'keyup', 'click', 'focus', 'blur', 'mouseup'];

/** @type {Map<HTMLInputElement, InputDecoration>} */
const registry = new Map();

/**
 * @param {string} name
 * @returns {{status: string, name: string}}
 */
function unknownLookup(name) {
    return { status: 'unknown', name, scope: null, value: null, secret: false, envName: null };
}

let lookupFn = unknownLookup;
/** @type {function(): (Object|null)} */
let urlVariablesFn = () => null;
let globalListenersInstalled = false;

/** @param {(name: string) => Object} fn */
export function setVariableLookup(fn) {
    lookupFn = typeof fn === 'function' ? fn : unknownLookup;
}

/** @param {function(): (Object|null)} fn */
export function setUrlVariableLookup(fn) {
    urlVariablesFn = typeof fn === 'function' ? fn : () => null;
}

/**
 * @param {string} name
 * @param {HTMLInputElement|null} [input]
 * @returns {Object}
 */
export function lookupVariable(name, input = null) {
    const decoration = input ? registry.get(input) : null;
    if (decoration?.url && !name.startsWith('$')) {
        const extra = urlVariablesFn();
        if (extra && Object.prototype.hasOwnProperty.call(extra, name)) {
            return { status: 'path-param', name, scope: 'path-param', value: stringValue(extra[name]), secret: false, envName: null };
        }
    }
    return lookupFn(name) ?? unknownLookup(name);
}

/**
 * @param {*} value
 * @returns {string}
 */
function stringValue(value) {
    return value === null || value === undefined ? '' : String(value);
}

/**
 * @param {Element|null} input
 * @returns {boolean}
 */
function isDecoratable(input) {
    return Boolean(input)
        && input.tagName === 'INPUT'
        && DECORATABLE_TYPES.has((input.getAttribute('type') || 'text').toLowerCase());
}

/**
 * @param {HTMLInputElement} input
 * @returns {boolean}
 */
export function isDecorated(input) {
    return registry.has(input);
}

/**
 * @param {HTMLInputElement} input
 * @returns {InputDecoration|null}
 */
export function getDecoration(input) {
    return registry.get(input) ?? null;
}

/**
 * @param {HTMLInputElement} input
 * @param {Object} [options]
 * @param {boolean} [options.url]
 * @returns {HTMLElement|null}
 */
export function decorateInput(input, { url = false } = {}) {
    if (!isDecoratable(input)) {
        return null;
    }
    const existing = registry.get(input);
    if (existing) {
        existing.url = existing.url || url;
        return existing.wrapper;
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'var-field';
    for (const className of input.classList) {
        wrapper.classList.add(`var-field--${className}`);
    }

    const mirror = document.createElement('span');
    mirror.className = 'var-field-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'var-field-mirror-text';
    mirror.appendChild(text);

    if (input.parentNode) {
        input.parentNode.insertBefore(wrapper, input);
    }
    input.spellcheck = false;
    wrapper.appendChild(input);
    wrapper.appendChild(mirror);

    const decoration = { input, wrapper, mirror, text, url, hasTokens: false, lastValue: null, metricsCopied: false, raf: 0 };
    registry.set(input, decoration);
    attachListeners(decoration);
    ensureGlobalListeners();
    if (!copyMetrics(decoration)) {
        queueMicrotask(() => copyMetrics(decoration));
    }
    render(decoration);
    return wrapper;
}

/**
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
export function decorateInputsIn(root) {
    const wrappers = [];
    root?.querySelectorAll?.(DECORATABLE_SELECTOR).forEach((input) => {
        const wrapper = decorateInput(input);
        if (wrapper) {
            wrappers.push(wrapper);
        }
    });
    return wrappers;
}

/**
 * @param {HTMLInputElement} input
 * @returns {void}
 */
export function refreshInput(input) {
    const decoration = registry.get(input);
    if (decoration) {
        render(decoration);
    }
}

/** @returns {void} */
export function refreshAll() {
    for (const [input, decoration] of registry) {
        if (!input.isConnected && !decoration.wrapper.isConnected) {
            registry.delete(input);
            continue;
        }
        if (decoration.hasTokens || input.value !== decoration.lastValue) {
            render(decoration);
        }
    }
}

/** @returns {HTMLInputElement[]} */
export function getDecoratedInputs() {
    return [...registry.keys()];
}

/**
 * @param {InputDecoration} decoration
 * @returns {void}
 */
function attachListeners(decoration) {
    const { input } = decoration;
    input.addEventListener('input', () => {
        render(decoration);
        scheduleScrollSync(decoration);
    });
    for (const type of SYNC_EVENTS) {
        input.addEventListener(type, () => scheduleScrollSync(decoration));
    }
    input.addEventListener('focus', () => {
        if (input.value !== decoration.lastValue) {
            render(decoration);
        }
    });
}

/** @returns {void} */
function ensureGlobalListeners() {
    if (globalListenersInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    globalListenersInstalled = true;
    window.addEventListener(THEME_CHANGED_EVENT, () => {
        for (const decoration of registry.values()) {
            decoration.metricsCopied = false;
            copyMetrics(decoration);
        }
    });
}

/**
 * @param {InputDecoration} decoration
 * @returns {boolean}
 */
function copyMetrics(decoration) {
    const { input, mirror } = decoration;
    if (decoration.metricsCopied || !input.isConnected || typeof getComputedStyle !== 'function') {
        return decoration.metricsCopied;
    }
    const computed = getComputedStyle(input);
    for (const property of COPIED_STYLES) {
        const value = computed[property];
        if (value) {
            mirror.style[property] = value;
        }
    }
    decoration.metricsCopied = true;
    return true;
}

/**
 * @param {InputDecoration} decoration
 * @returns {void}
 */
function scheduleScrollSync(decoration) {
    if (decoration.raf) {
        return;
    }
    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 0);
    decoration.raf = schedule(() => {
        decoration.raf = 0;
        decoration.mirror.scrollLeft = decoration.input.scrollLeft;
    });
}

/**
 * @param {Object} entry
 * @returns {string}
 */
function statusClass(entry) {
    return STATUS_CLASSES.has(entry?.status) ? entry.status : 'unresolved';
}

/**
 * @param {InputDecoration} decoration
 * @returns {void}
 */
function render(decoration) {
    const { input, text } = decoration;
    const { value } = input;
    const tokens = tokenize(value);
    decoration.lastValue = value;
    if (!decoration.metricsCopied) {
        copyMetrics(decoration);
    }
    if (tokens.length === 0) {
        text.textContent = value;
        decoration.hasTokens = false;
        return;
    }
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const token of tokens) {
        if (token.start > cursor) {
            fragment.appendChild(document.createTextNode(value.slice(cursor, token.start)));
        }
        const pill = document.createElement('span');
        pill.className = `var-token ${statusClass(lookupVariable(token.name, input))}`;
        pill.dataset.var = token.name;
        pill.textContent = token.raw;
        fragment.appendChild(pill);
        cursor = token.end;
    }
    if (cursor < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(cursor)));
    }
    text.replaceChildren(fragment);
    decoration.hasTokens = true;
}
