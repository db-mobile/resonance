/**
 * @fileoverview Traversal and editing of a collection's endpoints and nested folders
 * @module collections/collectionTree
 */

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
function* walkFolderRequests(folders, chain, seen) {
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
        yield* walkFolderRequests(folder.folders, nested, seen);
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
    const foldered = foldedRequestIds(collection.folders);
    const seen = new Set();

    for (const endpoint of collection.endpoints ?? []) {
        if (!endpoint || foldered.has(endpoint.id) || seen.has(endpoint.id)) {
            continue;
        }
        seen.add(endpoint.id);
        yield { request: endpoint, chain: [] };
    }

    yield* walkFolderRequests(collection.folders, [], seen);
}

/**
 * @param {Object|null|undefined} collection
 * @yields {Object}
 */
export function* walkFolders(collection) {
    if (!collection) {
        return;
    }
    yield* walkFolderTree(collection.folders);
}

/**
 * @param {Array|null|undefined} folders
 * @yields {Object}
 */
function* walkFolderTree(folders) {
    for (const folder of folders ?? []) {
        if (!folder) {
            continue;
        }
        yield folder;
        yield* walkFolderTree(folder.folders);
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
    return (collection?.folders ?? []).filter(Boolean);
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
 * @param {Object} collection
 * @param {string} requestId
 * @param {Object} patch
 * @returns {Object|null}
 */
export function updateRequest(collection, requestId, patch) {
    if (!findRequest(collection, requestId)) {
        return null;
    }

    return {
        ...collection,
        endpoints: patchList(collection.endpoints, requestId, patch),
        folders: patchFolderRequests(collection.folders, requestId, patch)
    };
}

/**
 * @param {Array|null|undefined} folders
 * @param {string} requestId
 * @param {Object} patch
 * @returns {Array}
 */
function patchFolderRequests(folders, requestId, patch) {
    return (folders ?? []).map(folder => {
        const next = { ...folder, endpoints: patchList(folder?.endpoints, requestId, patch) };
        if (Array.isArray(folder?.folders)) {
            next.folders = patchFolderRequests(folder.folders, requestId, patch);
        }
        return next;
    });
}

/**
 * @param {Array|null|undefined} folders
 * @param {string} folderId
 * @param {function(Object): Object} transform
 * @returns {Array}
 */
function mapFolder(folders, folderId, transform) {
    return (folders ?? []).map(folder => {
        if (folder?.id === folderId) {
            return transform(folder);
        }
        if (Array.isArray(folder?.folders)) {
            return { ...folder, folders: mapFolder(folder.folders, folderId, transform) };
        }
        return folder;
    });
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

    return {
        ...collection,
        folders: mapFolder(collection.folders, folderId, folder => ({ ...folder, ...patch }))
    };
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

    return {
        ...collection,
        endpoints: (collection.endpoints ?? []).filter(endpoint => endpoint?.id !== requestId),
        folders: removeFromFolders(collection.folders, requestId)
    };
}

/**
 * @param {Array|null|undefined} folders
 * @param {string} requestId
 * @returns {Array}
 */
function removeFromFolders(folders, requestId) {
    return (folders ?? []).map(folder => {
        const next = {
            ...folder,
            endpoints: (folder?.endpoints ?? []).filter(endpoint => endpoint?.id !== requestId)
        };
        if (Array.isArray(folder?.folders)) {
            next.folders = removeFromFolders(folder.folders, requestId);
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

    const endpoints = [...(collection.endpoints ?? []), request];
    if (!folderId) {
        return { ...collection, endpoints };
    }

    return {
        ...collection,
        endpoints,
        folders: mapFolder(collection.folders, folderId, folder => ({
            ...folder,
            endpoints: [...(folder.endpoints ?? []), request]
        }))
    };
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

    const node = { endpoints: [], ...folder };
    if (!parentFolderId) {
        return { ...collection, folders: [...(collection.folders ?? []), node] };
    }
    return {
        ...collection,
        folders: mapFolder(collection.folders, parentFolderId, parent => ({
            ...parent,
            folders: [...(parent.folders ?? []), node]
        }))
    };
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
    const visit = (folders, depth) => {
        for (const folder of folders ?? []) {
            if (!folder) {
                continue;
            }
            out.push({ id: folder.id, name: folder.name, depth });
            visit(folder.folders, depth + 1);
        }
    };
    visit(collection?.folders, 0);
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
