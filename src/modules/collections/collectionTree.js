/**
 * @fileoverview Shape-agnostic traversal and editing of a collection's request
 * tree. Every operation accepts both the wire shape (a flat `endpoints` array
 * plus nested `folders`, each with its own `endpoints`, with foldered requests
 * duplicated into the flat array) and the `items` tree, so callers never branch
 * on which one they hold. Requests are yielded exactly once regardless of shape,
 * at any nesting depth.
 * @module collections/collectionTree
 */

const FOLDER = 'folder';
const REQUEST = 'request';

/**
 * Reports whether a collection carries the nested `items` tree.
 * @param {Object|null|undefined} collection - Collection to inspect
 * @returns {boolean} True when the collection has an `items` array
 */
function usesItemsTree(collection) {
    return Array.isArray(collection?.items);
}

/**
 * Collects the ids of every request a legacy collection files inside a folder,
 * at any nesting depth.
 * @param {Array|null|undefined} folders - Folders to scan
 * @param {Set<string>} ids - Accumulator
 * @returns {Set<string>} Ids present in any folder
 */
function foldedRequestIds(folders, ids = new Set()) {
    for (const folder of folders ?? []) {
        for (const endpoint of folder?.endpoints ?? []) {
            if (endpoint) {
                ids.add(endpoint.id);
            }
        }
        foldedRequestIds(folder?.folders, ids);
    }
    return ids;
}

/**
 * Walks a legacy collection's folders, descending into nested ones.
 * @param {Array|null|undefined} folders - Folders to walk
 * @param {Object[]} chain - Folder chain accumulated so far, root first
 * @param {Set<string>} seen - Ids already yielded
 * @yields {{request: Object, chain: Object[]}} Each request with its folder chain
 */
function* walkLegacyFolders(folders, chain, seen) {
    for (const folder of folders ?? []) {
        if (!folder) {
            continue;
        }
        const nested = [...chain, folder];
        for (const endpoint of folder.endpoints ?? []) {
            if (!endpoint || seen.has(endpoint.id)) {
                continue;
            }
            seen.add(endpoint.id);
            yield { request: endpoint, chain: nested };
        }
        yield* walkLegacyFolders(folder.folders, nested, seen);
    }
}

/**
 * Walks a legacy collection, yielding root-level requests before foldered ones.
 * @param {Object} collection - Legacy-shaped collection
 * @yields {{request: Object, chain: Object[]}} Each request with its folder chain
 */
function* walkLegacy(collection) {
    const foldered = foldedRequestIds(collection.folders);
    const seen = new Set();

    for (const endpoint of collection.endpoints ?? []) {
        if (!endpoint || foldered.has(endpoint.id) || seen.has(endpoint.id)) {
            continue;
        }
        seen.add(endpoint.id);
        yield { request: endpoint, chain: [] };
    }

    yield* walkLegacyFolders(collection.folders, [], seen);
}

/**
 * Walks an `items` array depth-first, descending into folders.
 * @param {Array|null|undefined} items - Items to walk
 * @param {Object[]} chain - Folder chain accumulated so far, root first
 * @yields {{request: Object, chain: Object[]}} Each request with its folder chain
 */
function* walkItems(items, chain = []) {
    for (const item of items ?? []) {
        if (!item) {
            continue;
        }
        if (item.type === FOLDER) {
            yield* walkItems(item.items, [...chain, item]);
        } else {
            yield { request: item, chain };
        }
    }
}

/**
 * Walks every request in a collection, whichever shape it uses.
 * @param {Object|null|undefined} collection - Collection to walk
 * @yields {{request: Object, chain: Object[]}} Each request with its folder chain
 */
function* walkRequests(collection) {
    if (!collection) {
        return;
    }
    if (usesItemsTree(collection)) {
        yield* walkItems(collection.items);
    } else {
        yield* walkLegacy(collection);
    }
}

/**
 * Walks every folder in a collection, parents before their children.
 * @param {Object|null|undefined} collection - Collection to walk
 * @yields {Object} Each folder
 */
function* walkFolders(collection) {
    if (!collection) {
        return;
    }
    if (!usesItemsTree(collection)) {
        yield* walkLegacyFolderTree(collection.folders);
        return;
    }
    yield* walkFolderItems(collection.items);
}

/**
 * Walks legacy folders depth-first, yielding each before its children.
 * @param {Array|null|undefined} folders - Folders to walk
 * @yields {Object} Each folder
 */
function* walkLegacyFolderTree(folders) {
    for (const folder of folders ?? []) {
        if (!folder) {
            continue;
        }
        yield folder;
        yield* walkLegacyFolderTree(folder.folders);
    }
}

/**
 * Walks folder items depth-first, yielding each folder before its children.
 * @param {Array|null|undefined} items - Items to walk
 * @yields {Object} Each folder
 */
function* walkFolderItems(items) {
    for (const item of items ?? []) {
        if (item?.type === FOLDER) {
            yield item;
            yield* walkFolderItems(item.items);
        }
    }
}

/**
 * Lists every request in a collection in tree order, each exactly once.
 * @param {Object|null|undefined} collection - Collection to flatten
 * @returns {Object[]} Requests by reference, root-level ones first
 */
export function flattenRequests(collection) {
    return Array.from(walkRequests(collection), entry => entry.request);
}

/**
 * Lists the requests sitting directly at a collection's root, outside any folder.
 * @param {Object|null|undefined} collection - Collection to inspect
 * @returns {Object[]} Root-level requests by reference, in tree order
 */
export function rootRequests(collection) {
    const roots = [];
    for (const entry of walkRequests(collection)) {
        if (entry.chain.length === 0) {
            roots.push(entry.request);
        }
    }
    return roots;
}

/**
 * Lists a collection's top-level folders.
 * @param {Object|null|undefined} collection - Collection to inspect
 * @returns {Object[]} Top-level folders by reference, in tree order
 */
export function topLevelFolders(collection) {
    if (!collection) {
        return [];
    }
    if (!usesItemsTree(collection)) {
        return (collection.folders ?? []).filter(Boolean);
    }
    return collection.items.filter(item => item?.type === FOLDER);
}

/**
 * Finds a request by id anywhere in a collection.
 * @param {Object|null|undefined} collection - Collection to search
 * @param {string} requestId - Request id to look for
 * @returns {Object|null} The request by reference, or null when absent
 */
export function findRequest(collection, requestId) {
    for (const entry of walkRequests(collection)) {
        if (entry.request.id === requestId) {
            return entry.request;
        }
    }
    return null;
}

/**
 * Finds a folder by id anywhere in a collection.
 * @param {Object|null|undefined} collection - Collection to search
 * @param {string} folderId - Folder id to look for
 * @returns {Object|null} The folder by reference, or null when absent
 */
export function findFolder(collection, folderId) {
    for (const folder of walkFolders(collection)) {
        if (folder.id === folderId) {
            return folder;
        }
    }
    return null;
}

/**
 * Lists the folders enclosing a request, outermost first.
 * @param {Object|null|undefined} collection - Collection to search
 * @param {string} requestId - Request id to locate
 * @returns {Object[]} Folder chain root to leaf, empty for a root-level request
 */
export function folderChainForRequest(collection, requestId) {
    for (const entry of walkRequests(collection)) {
        if (entry.request.id === requestId) {
            return entry.chain;
        }
    }
    return [];
}

/**
 * Applies a patch to the request matching an id, leaving other entries as-is.
 * @param {Array|null|undefined} list - Requests to map over
 * @param {string} requestId - Request id to patch
 * @param {Object} patch - Fields to merge into the matching request
 * @returns {Array} A new list with the matching request replaced
 */
function patchList(list, requestId, patch) {
    return (list ?? []).map(entry =>
        entry?.id === requestId ? { ...entry, ...patch } : entry
    );
}

/**
 * Applies a patch to the matching request inside an `items` tree.
 * @param {Array|null|undefined} items - Items to map over
 * @param {string} requestId - Request id to patch
 * @param {Object} patch - Fields to merge into the matching request
 * @returns {Array} A new items array with the matching request replaced
 */
function patchItems(items, requestId, patch) {
    return (items ?? []).map(item => {
        if (item?.type === FOLDER) {
            return { ...item, items: patchItems(item.items, requestId, patch) };
        }
        return item?.id === requestId ? { ...item, ...patch } : item;
    });
}

/**
 * Merges fields into a request, patching every copy the shape holds.
 * @param {Object} collection - Collection to update
 * @param {string} requestId - Request id to patch
 * @param {Object} patch - Fields to merge into the request
 * @returns {Object|null} A new collection, or null when the request is absent
 */
export function updateRequest(collection, requestId, patch) {
    if (!findRequest(collection, requestId)) {
        return null;
    }

    if (usesItemsTree(collection)) {
        return { ...collection, items: patchItems(collection.items, requestId, patch) };
    }

    return {
        ...collection,
        endpoints: patchList(collection.endpoints, requestId, patch),
        folders: patchLegacyFolderRequests(collection.folders, requestId, patch)
    };
}

/**
 * Applies a patch to a request inside a legacy folder array, at any depth.
 * @param {Array|null|undefined} folders - Folders to map over
 * @param {string} requestId - Request id to patch
 * @param {Object} patch - Fields to merge into the request
 * @returns {Array} A new folders array
 */
function patchLegacyFolderRequests(folders, requestId, patch) {
    return (folders ?? []).map(folder => {
        const next = { ...folder, endpoints: patchList(folder?.endpoints, requestId, patch) };
        if (Array.isArray(folder?.folders)) {
            next.folders = patchLegacyFolderRequests(folder.folders, requestId, patch);
        }
        return next;
    });
}

/**
 * Applies a patch to the matching folder inside an `items` tree.
 * @param {Array|null|undefined} items - Items to map over
 * @param {string} folderId - Folder id to patch
 * @param {Object} patch - Fields to merge into the matching folder
 * @returns {Array} A new items array with the matching folder replaced
 */
function patchFolderItems(items, folderId, patch) {
    return (items ?? []).map(item => {
        if (item?.type !== FOLDER) {
            return item;
        }
        if (item.id === folderId) {
            return { ...item, ...patch };
        }
        return { ...item, items: patchFolderItems(item.items, folderId, patch) };
    });
}

/**
 * Merges fields into a folder, at any nesting depth.
 * @param {Object} collection - Collection to update
 * @param {string} folderId - Folder id to patch
 * @param {Object} patch - Fields to merge into the folder
 * @returns {Object|null} A new collection, or null when the folder is absent
 */
export function updateFolder(collection, folderId, patch) {
    if (!findFolder(collection, folderId)) {
        return null;
    }

    if (usesItemsTree(collection)) {
        return { ...collection, items: patchFolderItems(collection.items, folderId, patch) };
    }

    return {
        ...collection,
        folders: patchLegacyFolders(collection.folders, folderId, patch)
    };
}

/**
 * Applies a patch to the matching folder inside a legacy folder array.
 * @param {Array|null|undefined} folders - Folders to map over
 * @param {string} folderId - Folder id to patch
 * @param {Object} patch - Fields to merge into the matching folder
 * @returns {Array} A new folders array with the matching folder replaced
 */
function patchLegacyFolders(folders, folderId, patch) {
    return (folders ?? []).map(folder => {
        if (folder?.id === folderId) {
            return { ...folder, ...patch };
        }
        if (Array.isArray(folder?.folders)) {
            return { ...folder, folders: patchLegacyFolders(folder.folders, folderId, patch) };
        }
        return folder;
    });
}

/**
 * Drops requests matching an id from an `items` tree.
 * @param {Array|null|undefined} items - Items to filter
 * @param {string} requestId - Request id to remove
 * @returns {Array} A new items array without the request
 */
function removeFromItems(items, requestId) {
    const result = [];
    for (const item of items ?? []) {
        if (item?.type === FOLDER) {
            result.push({ ...item, items: removeFromItems(item.items, requestId) });
        } else if (item?.id !== requestId) {
            result.push(item);
        }
    }
    return result;
}

/**
 * Removes a request from a collection without pruning emptied folders.
 * @param {Object} collection - Collection to update
 * @param {string} requestId - Request id to remove
 * @returns {Object|null} A new collection, or null when the request is absent
 */
export function removeRequest(collection, requestId) {
    if (!findRequest(collection, requestId)) {
        return null;
    }

    if (usesItemsTree(collection)) {
        return { ...collection, items: removeFromItems(collection.items, requestId) };
    }

    return {
        ...collection,
        endpoints: (collection.endpoints ?? []).filter(endpoint => endpoint?.id !== requestId),
        folders: removeFromLegacyFolders(collection.folders, requestId)
    };
}

/**
 * Drops a request from a legacy folder array, at any depth.
 * @param {Array|null|undefined} folders - Folders to map over
 * @param {string} requestId - Request id to remove
 * @returns {Array} A new folders array
 */
function removeFromLegacyFolders(folders, requestId) {
    return (folders ?? []).map(folder => {
        const next = {
            ...folder,
            endpoints: (folder?.endpoints ?? []).filter(endpoint => endpoint?.id !== requestId)
        };
        if (Array.isArray(folder?.folders)) {
            next.folders = removeFromLegacyFolders(folder.folders, requestId);
        }
        return next;
    });
}

/**
 * Appends a request into a folder, or at the root when no folder is given.
 * @param {Object} collection - Collection to update
 * @param {string|null} folderId - Target folder id, or null for the root
 * @param {Object} request - Request to append
 * @returns {Object} A new collection containing the request
 * @throws {Error} If folderId is given but no such folder exists
 */
export function insertRequest(collection, folderId, request) {
    if (folderId && !findFolder(collection, folderId)) {
        throw new Error(`Folder with id ${folderId} not found in collection`);
    }

    if (usesItemsTree(collection)) {
        const node = request.type ? request : { ...request, type: REQUEST };
        if (!folderId) {
            return { ...collection, items: [...collection.items, node] };
        }
        return { ...collection, items: insertIntoFolderItems(collection.items, folderId, node) };
    }

    const endpoints = [...(collection.endpoints ?? []), request];
    if (!folderId) {
        return { ...collection, endpoints };
    }

    return {
        ...collection,
        endpoints,
        folders: (collection.folders ?? []).map(folder =>
            folder?.id === folderId
                ? { ...folder, endpoints: [...(folder.endpoints ?? []), request] }
                : folder
        )
    };
}

/**
 * Appends an item into the matching folder inside an `items` tree.
 * @param {Array|null|undefined} items - Items to map over
 * @param {string} folderId - Target folder id
 * @param {Object} node - Item to append
 * @returns {Array} A new items array with the node appended
 */
function insertIntoFolderItems(items, folderId, node) {
    return (items ?? []).map(item => {
        if (item?.type !== FOLDER) {
            return item;
        }
        if (item.id === folderId) {
            return { ...item, items: [...(item.items ?? []), node] };
        }
        return { ...item, items: insertIntoFolderItems(item.items, folderId, node) };
    });
}
