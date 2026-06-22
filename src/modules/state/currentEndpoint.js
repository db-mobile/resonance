/**
 * @fileoverview Holds the "currently loaded endpoint" — the collection/endpoint identity that
 * the active request view is editing. Read when sending requests, saving body edits, writing
 * history, and validating schemas; written when an endpoint is loaded, saved, or cleared.
 * @module state/currentEndpoint
 *
 * This is shared mutable app state, deliberately encapsulated behind accessors (rather than
 * left on `window` or mixed into the service locator in appContext.js) so the single mutation
 * point can later gain validation or change-notification if needed.
 *
 * @typedef {{ collectionId: string, endpointId: string, [key: string]: * }} EndpointRef
 */

/** @type {EndpointRef|null} */
let current = null;

/**
 * @returns {EndpointRef|null} The currently loaded endpoint, or null if none.
 */
export function getCurrentEndpoint() {
    return current;
}

/**
 * @param {EndpointRef|null} value - The endpoint to mark as current, or null to clear.
 */
export function setCurrentEndpoint(value) {
    current = value;
}
