/**
 * @fileoverview The single translation point between a collection as the
 * backend stores it (the wire shape) and the collection object the rest of the
 * renderer works with (the domain shape). Every read normalizes through
 * fromWire and every write through toWire, so the storage format can change
 * without the shape rippling out past CollectionRepository.
 * @module storage/collectionMapper
 */

/**
 * Keys the renderer attaches at runtime that must never reach storage. Search
 * filtering marks matched collections and folders so the tree can auto-expand
 * them, on the very objects a later save would persist.
 */
const TRANSIENT_KEYS = Object.freeze(['__searchExpand']);

/**
 * Returns a copy of an object without any transient runtime-only keys.
 * @param {Object} value - Object to clean
 * @returns {Object} A shallow copy carrying no transient keys
 */
function withoutTransients(value) {
    const cleaned = { ...value };
    for (const key of TRANSIENT_KEYS) {
        delete cleaned[key];
    }
    return cleaned;
}

/**
 * Normalizes one folder read from the backend.
 * @param {Object} folder - Folder as stored
 * @returns {Object} Folder with its endpoints array guaranteed
 */
function folderFromWire(folder) {
    return { ...folder, endpoints: folder?.endpoints ?? [] };
}

/**
 * Normalizes one folder on its way to the backend.
 * @param {Object} folder - Folder as held in memory
 * @returns {Object} Folder without transient keys
 */
function folderToWire(folder) {
    return withoutTransients(folder);
}

/**
 * Strips transient keys from every folder in a nested `items` tree.
 * @param {Array} items - Items to clean
 * @returns {Array} A new items array carrying no transient keys
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
 * Converts a collection from the backend's wire shape to the domain shape.
 *
 * Guarantees `endpoints` and `folders` (and each folder's `endpoints`) are
 * arrays, so consumers never repeat the `|| []` guard.
 *
 * @param {Object|null|undefined} wire - Collection as returned by the backend
 * @returns {Object|null} The domain collection, or null when given nothing
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
 * Converts a collection from the domain shape to the backend's wire shape.
 *
 * Strips renderer-only markers so a save never persists them.
 *
 * @param {Object|null|undefined} collection - Collection as held in memory
 * @returns {Object|null} The wire collection, or null when given nothing
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
 * Converts a list of collections read from the backend.
 * @param {Array|null|undefined} wireList - Collections as returned by the backend
 * @returns {Object[]} The domain collections, skipping empty entries
 */
export function listFromWire(wireList) {
    return (wireList ?? []).map(fromWire).filter(Boolean);
}
