/**
 * @fileoverview Holds the "currently loaded endpoint" — the collection/endpoint identity that
 * @module state/currentEndpoint
 * @typedef {{ collectionId: string, endpointId: string, [key: string]: * }} EndpointRef
 */

/** @type {EndpointRef|null} */
let current = null;

/** @returns {EndpointRef|null} */
export function getCurrentEndpoint() {
    return current;
}

/** @param {EndpointRef|null} value */
export function setCurrentEndpoint(value) {
    current = value;
}
