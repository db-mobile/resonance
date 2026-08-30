/**
 * Registry of pending debounced-save handles so context switches can flush
 * or cancel outstanding saves before the shared form DOM is repopulated.
 */

const handles = new Set();

/**
 * Registers a pending-save handle.
 * @param {{flush: function(): Promise<void>, cancel: function(): void}} handle Save handle to register
 * @returns {function(): void} Unregister function
 */
export function registerPendingSave(handle) {
    handles.add(handle);
    return () => handles.delete(handle);
}

/**
 * Flushes every registered pending save and waits for completion.
 * @returns {Promise<void>} Resolves when all flushes settle
 */
export async function flushPendingSaves() {
    await Promise.all([...handles].map((handle) => handle.flush()));
}

/**
 * Cancels every registered pending save without executing it.
 * @returns {void}
 */
export function cancelPendingSaves() {
    for (const handle of handles) {
        handle.cancel();
    }
}
