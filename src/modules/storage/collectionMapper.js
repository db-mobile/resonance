/**
 * @fileoverview The single translation point between a collection as the
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
 * @param {Array} items
 * @returns {Array}
 */
function itemsToWire(items) {
    return items.map(item => {
        if (item?.type !== 'folder') {
            return item;
        }
        const folder = withoutTransients(item);
        if (Array.isArray(folder.items)) {
            folder.items = itemsToWire(folder.items);
        }
        return folder;
    });
}

/**
 * @param {Object|null|undefined} wire
 * @returns {Object|null}
 */
export function fromWire(wire) {
    if (!wire) {
        return null;
    }

    if (Array.isArray(wire.items)) {
        return { ...wire };
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
    if (Array.isArray(wire.items)) {
        wire.items = itemsToWire(wire.items);
    }
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
