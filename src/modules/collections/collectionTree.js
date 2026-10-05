/**
 * @fileoverview Shape-agnostic traversal and editing of a collection's request
 * @module collections/collectionTree
 */

const FOLDER = 'folder';
const REQUEST = 'request';

/**
 * @param {Object|null|undefined} collection
 * @returns {boolean}
 */
function usesItemsTree(collection) {
    return Array.isArray(collection?.items);
}

/**
 * @param {Array|null|undefined} folders
 * @param {Set<string>} ids
 * @returns {Set<string>}
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
 * @param {Array|null|undefined} folders
 * @param {Object[]} chain
 * @param {Set<string>} seen
 * @yields {{request: Object, chain: Object[]}}
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
 * @param {Object} collection
 * @yields {{request: Object, chain: Object[]}}
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
 * @param {Array|null|undefined} items
 * @param {Object[]} chain
 * @yields {{request: Object, chain: Object[]}}
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
 * @param {Object|null|undefined} collection
 * @yields {{request: Object, chain: Object[]}}
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
 * @param {Object|null|undefined} collection
 * @yields {Object}
 */
export function* walkFolders(collection) {
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
 * @param {Array|null|undefined} folders
 * @yields {Object}
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
 * @param {Array|null|undefined} items
 * @yields {Object}
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
 * @param {Object|null|undefined} collection
 * @returns {Object[]}
 */
export function flattenRequests(collection) {
    return Array.from(walkRequests(collection), entry => entry.request);
}

/**
 * @param {Object|null|undefined} collection
 * @param {string} folderId
 * @returns {Object[]}
 */
export function requestsInFolder(collection, folderId) {
    return Array.from(walkRequests(collection))
        .filter(entry => entry.chain.some(folder => folder.id === folderId))
        .map(entry => entry.request);
}

/**
 * @param {Object|null|undefined} collection
 * @returns {Object[]}
 */
export function rootRequests(collection) {
    return Array.from(walkRequests(collection))
        .filter(entry => entry.chain.length === 0)
        .map(entry => entry.request);
}

/**
 * @param {Object|null|undefined} collection
 * @returns {Object[]}
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
 * @param {Object|null|undefined} collection
 * @param {string} requestId
 * @returns {{request: Object, chain: Object[]}|null}
 */
function findEntry(collection, requestId) {
    for (const entry of walkRequests(collection)) {
        if (entry.request.id === requestId) {
            return entry;
        }
    }
    return null;
}

/**
 * @param {Object|null|undefined} collection
 * @param {string} requestId
 * @returns {Object|null}
 */
export function findRequest(collection, requestId) {
    return findEntry(collection, requestId)?.request ?? null;
}

/**
 * @param {Object|null|undefined} collection
 * @param {string} folderId
 * @returns {Object|null}
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
 * @param {Object|null|undefined} collection
 * @param {string} requestId
 * @returns {Object[]}
 */
export function folderChainForRequest(collection, requestId) {
    return findEntry(collection, requestId)?.chain ?? [];
}

/**
 * @param {Array|null|undefined} list
 * @param {string} requestId
 * @param {Object} patch
 * @returns {Array}
 */
function patchList(list, requestId, patch) {
    return (list ?? []).map(entry =>
        entry?.id === requestId ? { ...entry, ...patch } : entry
    );
}

/**
 * @param {Array|null|undefined} items
 * @param {string} requestId
 * @param {Object} patch
 * @returns {Array}
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
 * @param {Object} collection
 * @param {string} requestId
 * @param {Object} patch
 * @returns {Object|null}
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
 * @param {Array|null|undefined} folders
 * @param {string} requestId
 * @param {Object} patch
 * @returns {Array}
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
 * @param {Array|null|undefined} items
 * @param {string} folderId
 * @param {function(Object): Object} transform
 * @returns {Array}
 */
function mapFolderItem(items, folderId, transform) {
    return (items ?? []).map(item => {
        if (item?.type !== FOLDER) {
            return item;
        }
        if (item.id === folderId) {
            return transform(item);
        }
        return { ...item, items: mapFolderItem(item.items, folderId, transform) };
    });
}

/**
 * @param {Array|null|undefined} folders
 * @param {string} folderId
 * @param {function(Object): Object} transform
 * @returns {Array}
 */
function mapLegacyFolder(folders, folderId, transform) {
    return (folders ?? []).map(folder => {
        if (folder?.id === folderId) {
            return transform(folder);
        }
        if (Array.isArray(folder?.folders)) {
            return { ...folder, folders: mapLegacyFolder(folder.folders, folderId, transform) };
        }
        return folder;
    });
}

/**
 * @param {Array|null|undefined} items
 * @param {string} folderId
 * @param {Object} patch
 * @returns {Array}
 */
function patchFolderItems(items, folderId, patch) {
    return mapFolderItem(items, folderId, item => ({ ...item, ...patch }));
}

/**
 * @param {Object} collection
 * @param {string} folderId
 * @param {Object} patch
 * @returns {Object|null}
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
 * @param {Array|null|undefined} folders
 * @param {string} folderId
 * @param {Object} patch
 * @returns {Array}
 */
function patchLegacyFolders(folders, folderId, patch) {
    return mapLegacyFolder(folders, folderId, folder => ({ ...folder, ...patch }));
}

/**
 * @param {Array|null|undefined} items
 * @param {string} requestId
 * @returns {Array}
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
 * @param {Object} collection
 * @param {string} requestId
 * @returns {Object|null}
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
 * @param {Array|null|undefined} folders
 * @param {string} requestId
 * @returns {Array}
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
 * @param {Object} collection
 * @param {string|null} folderId
 * @param {Object} request
 * @returns {Object}
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
        folders: insertIntoLegacyFolders(collection.folders, folderId, request)
    };
}

/**
 * @param {Array|null|undefined} folders
 * @param {string} folderId
 * @param {Object} request
 * @returns {Array}
 */
function insertIntoLegacyFolders(folders, folderId, request) {
    return mapLegacyFolder(folders, folderId, folder => ({
        ...folder,
        endpoints: [...(folder.endpoints ?? []), request]
    }));
}

/**
 * @param {Array|null|undefined} items
 * @param {string} folderId
 * @param {Object} node
 * @returns {Array}
 */
function insertIntoFolderItems(items, folderId, node) {
    return mapFolderItem(items, folderId, item => ({ ...item, items: [...(item.items ?? []), node] }));
}

/**
 * @param {Object} collection
 * @param {string|null} parentFolderId
 * @param {{id: string, name: string}} folder
 * @returns {Object}
 */
export function insertFolder(collection, parentFolderId, folder) {
    if (parentFolderId && !findFolder(collection, parentFolderId)) {
        throw new Error(`Folder with id ${parentFolderId} not found in collection`);
    }

    if (usesItemsTree(collection)) {
        const node = { type: FOLDER, items: [], ...folder };
        if (!parentFolderId) {
            return { ...collection, items: [...collection.items, node] };
        }
        return { ...collection, items: insertIntoFolderItems(collection.items, parentFolderId, node) };
    }

    const node = { endpoints: [], ...folder };
    if (!parentFolderId) {
        return { ...collection, folders: [...(collection.folders ?? []), node] };
    }
    return { ...collection, folders: insertSubfolder(collection.folders, parentFolderId, node) };
}

/**
 * @param {Array|null|undefined} folders
 * @param {string} parentFolderId
 * @param {Object} node
 * @returns {Array}
 */
function insertSubfolder(folders, parentFolderId, node) {
    return mapLegacyFolder(folders, parentFolderId, folder => ({
        ...folder,
        folders: [...(folder.folders ?? []), node]
    }));
}

/**
 * @param {Object} collection
 * @param {string} requestId
 * @param {string|null} targetFolderId
 * @returns {Object|null}
 */
export function moveRequest(collection, requestId, targetFolderId) {
    const request = findRequest(collection, requestId);
    if (!request) {
        return null;
    }
    if (targetFolderId && !findFolder(collection, targetFolderId)) {
        throw new Error(`Folder with id ${targetFolderId} not found in collection`);
    }
    return insertRequest(removeRequest(collection, requestId), targetFolderId, request);
}

/**
 * @param {Object} collection
 * @returns {Array<{id: string, name: string, depth: number}>}
 */
export function folderOutline(collection) {
    const out = [];
    const visitLegacy = (folders, depth) => {
        for (const folder of folders ?? []) {
            if (!folder) {
                continue;
            }
            out.push({ id: folder.id, name: folder.name, depth });
            visitLegacy(folder.folders, depth + 1);
        }
    };
    const visitItems = (items, depth) => {
        for (const item of items ?? []) {
            if (item?.type === FOLDER) {
                out.push({ id: item.id, name: item.name, depth });
                visitItems(item.items, depth + 1);
            }
        }
    };
    if (usesItemsTree(collection)) {
        visitItems(collection.items, 0);
    } else {
        visitLegacy(collection?.folders, 0);
    }
    return out;
}

/**
 * @param {string} collectionId
 * @param {string} endpointId
 * @returns {string}
 */
export function endpointKey(collectionId, endpointId) {
    return `${collectionId}_${endpointId}`;
}
