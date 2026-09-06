
const handles = new Set();

/**
 * @param {{flush: function(): Promise<void>, cancel: function(): void}} handle
 * @returns {function(): void}
 */
export function registerPendingSave(handle) {
    handles.add(handle);
    return () => handles.delete(handle);
}

/** @returns {Promise<void>} */
export async function flushPendingSaves() {
    await Promise.all([...handles].map((handle) => handle.flush()));
}

/** @returns {void} */
export function cancelPendingSaves() {
    for (const handle of handles) {
        handle.cancel();
    }
}
