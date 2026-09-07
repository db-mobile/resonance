/**
 * @fileoverview Trailing-edge debounce helper shared across the UI.
 * @module modules/utils/debounce
 */

/**
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function & {cancel: Function, flush: Function, pending: Function}}
 */
export function debounce(fn, wait) {
    let timer = null;
    let lastArgs = null;

    function invoke() {
        timer = null;
        const args = lastArgs;
        lastArgs = null;
        return fn(...args);
    }

    function debounced(...args) {
        lastArgs = args;
        clearTimeout(timer);
        timer = setTimeout(invoke, wait);
    }

    debounced.cancel = () => {
        clearTimeout(timer);
        timer = null;
        lastArgs = null;
    };

    debounced.flush = () => {
        if (timer === null) {
            return undefined;
        }
        clearTimeout(timer);
        return invoke();
    };

    debounced.pending = () => timer !== null;

    return debounced;
}
