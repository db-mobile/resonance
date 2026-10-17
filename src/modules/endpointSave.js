/**
 * @fileoverview Debounced persistence of the current endpoint's request modifications
 * @module endpointSave
 */

import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { app } from './appContext.js';
import { toast } from './ui/Toast.js';
import { debounce } from './utils/debounce.js';
import { registerPendingSave } from './state/pendingSaves.js';

const SAVE_DEBOUNCE_MS = 500;

let inFlightRequestSave = null;

/**
 * @param {string} collectionId
 * @param {string} endpointId
 */
const debouncedSaveRequestModifications = debounce((collectionId, endpointId) => {
    const controller = app.collectionController;
    if (!controller) {
        return Promise.resolve();
    }
    inFlightRequestSave = controller.saveAllRequestModifications(collectionId, endpointId)
        .catch(() => {
            toast.error('Failed to save changes');
        })
        .finally(() => {
            inFlightRequestSave = null;
        });
    return inFlightRequestSave;
}, SAVE_DEBOUNCE_MS);

/** @returns {Promise<void>} */
export async function flushPendingRequestSave() {
    await debouncedSaveRequestModifications.flush();
    await inFlightRequestSave;
}

/** @returns {void} */
export function cancelPendingRequestSave() {
    debouncedSaveRequestModifications.cancel();
}

/** @returns {void} */
export function scheduleEndpointSave() {
    const current = getCurrentEndpoint();
    if (current) {
        debouncedSaveRequestModifications(current.collectionId, current.endpointId);
    }
}

registerPendingSave({ flush: flushPendingRequestSave, cancel: cancelPendingRequestSave });
