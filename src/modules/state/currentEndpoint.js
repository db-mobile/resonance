/**
 * @fileoverview Holds the "currently loaded endpoint" — the collection/endpoint identity that
 * @module state/currentEndpoint
 * @typedef {{ collectionId: string, endpointId: string, [key: string]: * }} EndpointRef
 */

import { ChangeEmitter } from '../services/ChangeEmitter.js';

/** @type {EndpointRef|null} */
let current = null;

const events = new ChangeEmitter();

/** @returns {EndpointRef|null} */
export function getCurrentEndpoint() {
    return current;
}

/** @param {EndpointRef|null} value */
export function setCurrentEndpoint(value) {
    current = value;
    events.emit(current);
}

/**
 * @param {(endpoint: EndpointRef|null) => void} callback
 * @returns {() => void}
 */
export function onCurrentEndpointChange(callback) {
    events.add(callback);
    return () => events.remove(callback);
}
