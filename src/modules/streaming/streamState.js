/**
 * @fileoverview Dependency-free signal that a stream connection opened, closed, or the view changed
 * @module streaming/streamState
 */

/** @type {string} */
export const STREAM_STATE_EVENT = 'resonance:stream-state';

/** @returns {void} */
export function notifyStreamStateChanged() {
    if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent(STREAM_STATE_EVENT));
    }
}

/**
 * @param {Object|null} entry
 * @returns {boolean}
 */
export function isLiveEntry(entry) {
    return Boolean(entry?.state) && entry.state !== 'closed';
}

/**
 * @param {Object} current
 * @param {string} url
 * @param {string} eventType
 * @returns {boolean}
 */
export function isStaleEvent(current, url, eventType) {
    return Boolean(current.url && url && current.url !== url && eventType !== 'open');
}
