/**
 * @fileoverview Shared Escape-to-dismiss stack for overlay dialogs.
 * @module ui/modalEscape
 */

const handlers = [];

/** @type {ReadonlySet<string>} */
const PICKER_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week']);

/**
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function isPickerInput(target) {
    return Boolean(target) && target.tagName === 'INPUT' && PICKER_INPUT_TYPES.has(target.type);
}

/**
 * @param {KeyboardEvent} e
 * @returns {void}
 */
function onKeydown(e) {
    if (e.key !== 'Escape' || handlers.length === 0) {
        return;
    }
    e.stopPropagation();

    if (isPickerInput(e.target)) {
        e.target.blur();
        return;
    }

    handlers[handlers.length - 1]();
}

/**
 * @param {Function} handler
 * @returns {Function}
 */
export function pushEscapeHandler(handler) {
    if (handlers.length === 0) {
        document.addEventListener('keydown', onKeydown, true);
    }
    handlers.push(handler);

    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;

        const index = handlers.lastIndexOf(handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
            document.removeEventListener('keydown', onKeydown, true);
        }
    };
}

/** @returns {number} */
export function escapeHandlerCount() {
    return handlers.length;
}
