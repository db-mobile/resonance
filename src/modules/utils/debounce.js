/**
 * @fileoverview Trailing-edge debounce helper shared across the UI.
 * @module modules/utils/debounce
 */

/**
 * Creates a debounced wrapper that delays invoking `fn` until `wait` ms have
 * elapsed since the last call. Only the trailing call runs, using the most
 * recent arguments.
 *
 * @param {Function} fn - Function to debounce.
 * @param {number} wait - Delay in milliseconds.
 * @returns {Function & {cancel: Function, flush: Function, pending: Function}}
 *   The debounced function, augmented with:
 *   - `cancel()` - discard any pending invocation.
 *   - `flush()` - run a pending invocation immediately and return its result,
 *     or `undefined` when nothing is pending.
 *   - `pending()` - whether an invocation is currently scheduled.
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
