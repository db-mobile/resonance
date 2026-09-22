/**
 * @fileoverview Re-links saved collection-runner requests whose collection or endpoint id no longer exists
 * @module utils/runnerRequestLinks
 */

import { findRequest, flattenRequests } from '../collections/collectionTree.js';

/**
 * @param {string|undefined} path
 * @returns {string}
 */
function normalizePath(path) {
    return (path || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '{$1}');
}

/**
 * @param {Object} request
 * @param {Array<Object>} collections
 * @returns {Array<{collection: Object, endpoint: Object}>}
 */
function matchingEndpoints(request, collections) {
    const matches = [];
    const requestPath = normalizePath(request.path);
    for (const collection of collections) {
        for (const endpoint of flattenRequests(collection)) {
            if (
                endpoint.method === request.method &&
                normalizePath(endpoint.path) === requestPath &&
                (endpoint.name || endpoint.path) === request.name
            ) {
                matches.push({ collection, endpoint });
            }
        }
    }
    return matches;
}

/**
 * @param {Array<Object>} requests
 * @param {Array<Object>} collections
 * @returns {{requests: Array<Object>, relinked: number, missing: Set<number>}}
 */
export function resolveRequestLinks(requests, collections) {
    const missing = new Set();
    let relinked = 0;

    const resolved = (requests || []).map((request, index) => {
        const collection = (collections || []).find(candidate => candidate.id === request.collectionId);
        if (collection && findRequest(collection, request.endpointId)) {
            return request;
        }

        const matches = matchingEndpoints(request, collections || []);
        if (matches.length !== 1) {
            missing.add(index);
            return request;
        }

        relinked++;
        return { ...request, collectionId: matches[0].collection.id, endpointId: matches[0].endpoint.id };
    });

    return { requests: resolved, relinked, missing };
}
