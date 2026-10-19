/**
 * @fileoverview The saved request fields a runner override is compared against
 * @module services/endpointRequestConfig
 */

/**
 * @param {Object} collectionRepository
 * @param {string} collectionId
 * @param {string} endpointId
 * @returns {Promise<{pathParams: Array<Object>, queryParams: Array<Object>, headers: Array<Object>, body: string}>}
 */
export async function loadEndpointRequestConfig(collectionRepository, collectionId, endpointId) {
    const [pathParams, queryParams, headers, body] = await Promise.all([
        collectionRepository.getPersistedPathParams(collectionId, endpointId),
        collectionRepository.getPersistedQueryParams(collectionId, endpointId),
        collectionRepository.getPersistedHeaders(collectionId, endpointId),
        collectionRepository.getModifiedRequestBody(collectionId, endpointId)
    ]);

    return {
        pathParams: pathParams || [],
        queryParams: queryParams || [],
        headers: headers || [],
        body: body || ''
    };
}
