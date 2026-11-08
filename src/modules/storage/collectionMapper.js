/**
 * @fileoverview The single translation point between a collection as the UI tree sees it and its stored on-disk shape.
 * @module storage/collectionMapper
 */

const TRANSIENT_KEYS = Object.freeze(['__searchExpand']);

/**
 * @param {Object} value
 * @returns {Object}
 */
function withoutTransients(value) {
    const cleaned = { ...value };
    for (const key of TRANSIENT_KEYS) {
        delete cleaned[key];
    }
    return cleaned;
}

/**
 * @param {Object} folder
 * @returns {Object}
 */
function folderFromWire(folder) {
    return { ...folder, endpoints: folder?.endpoints ?? [] };
}

/**
 * @param {Object} endpoint
 * @param {Set<string>} keepExamplesFor
 * @returns {Object}
 */
function endpointToWire(endpoint, keepExamplesFor) {
    if (!endpoint || !('examples' in endpoint) || keepExamplesFor.has(endpoint.id)) {
        return endpoint;
    }
    const { examples: _examples, ...rest } = endpoint;
    return rest;
}

/**
 * @param {Object} folder
 * @param {Set<string>} keepExamplesFor
 * @returns {Object}
 */
function folderToWire(folder, keepExamplesFor) {
    const wire = withoutTransients(folder);
    if (Array.isArray(wire.endpoints)) {
        wire.endpoints = wire.endpoints.map((endpoint) => endpointToWire(endpoint, keepExamplesFor));
    }
    if (Array.isArray(wire.folders)) {
        wire.folders = wire.folders.map((child) => folderToWire(child, keepExamplesFor));
    }
    return wire;
}

/**
 * @param {Object|null|undefined} wire
 * @returns {Object|null}
 */
export function fromWire(wire) {
    if (!wire) {
        return null;
    }

    return {
        ...wire,
        endpoints: wire.endpoints ?? [],
        folders: (wire.folders ?? []).map(folderFromWire)
    };
}

/**
 * @param {Object|null|undefined} collection
 * @param {Object} [options]
 * @param {string[]} [options.keepExamplesFor]
 * @returns {Object|null}
 */
export function toWire(collection, { keepExamplesFor = [] } = {}) {
    if (!collection) {
        return null;
    }

    const keep = new Set(keepExamplesFor);
    const wire = withoutTransients(collection);
    if (Array.isArray(wire.endpoints)) {
        wire.endpoints = wire.endpoints.map((endpoint) => endpointToWire(endpoint, keep));
    }
    if (Array.isArray(wire.folders)) {
        wire.folders = wire.folders.map((folder) => folderToWire(folder, keep));
    }
    return wire;
}

/**
 * @param {Array|null|undefined} wireList
 * @returns {Object[]}
 */
export function listFromWire(wireList) {
    return (wireList ?? []).map(fromWire).filter(Boolean);
}
