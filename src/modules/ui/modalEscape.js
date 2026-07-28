/**
 * @fileoverview Shared Escape-to-dismiss stack for overlay dialogs.
 * @module ui/modalEscape
 *
 * Dialogs used to each register their own `keydown` listener on the document.
 * That gave two recurring defects: a listener removed only inside the
 * `if (e.key === 'Escape')` branch outlived every other close path, and a dialog
 * opened on top of another let one keypress dismiss both. Registering here
 * instead means only the topmost dialog sees Escape, and the returned release
 * function is the single teardown every close path can call.
 */

const handlers = [];

/**
 * Dispatches Escape to the topmost registered dialog only, and stops the event
 * so neither the dialogs beneath it nor the app-level shortcuts also react.
 *
 * @param {KeyboardEvent} e - The captured keydown event
 * @returns {void}
 */
function onKeydown(e) {
    if (e.key !== 'Escape' || handlers.length === 0) {
        return;
    }
    e.stopPropagation();
    handlers[handlers.length - 1]();
}

/**
 * Registers a dismiss handler as the topmost Escape target.
 *
 * @param {Function} handler - Called when Escape is pressed while this is topmost
 * @returns {Function} Idempotent release; call it from every close path
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

/**
 * Number of dialogs currently registered; for tests asserting no leaks.
 *
 * @returns {number}
 */
export function escapeHandlerCount() {
    return handlers.length;
}
