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
 * @param {Object} folder
 * @returns {Object}
 */
function folderToWire(folder) {
    return withoutTransients(folder);
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
 * @returns {Object|null}
 */
export function toWire(collection) {
    if (!collection) {
        return null;
    }

    const wire = withoutTransients(collection);
    if (Array.isArray(wire.folders)) {
        wire.folders = wire.folders.map(folderToWire);
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
