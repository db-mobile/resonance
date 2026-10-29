/**
 * @fileoverview The one place that writes a newly created request's sidecar records from a request payload
 * @module collections/endpointSidecars
 */

import { normalizeKeyValueRows } from '../utils/keyValueRows.js';
import { normalizeMqttData } from '../mqtt/mqttFields.js';
import { normalizeWebSocketData } from '../websocket/websocketFields.js';

/**
 * @param {Object|Array|null|undefined} pathParams
 * @returns {Array<{key: string, value: string}>}
 */
function pathParamEntries(pathParams) {
    if (Array.isArray(pathParams)) {
        return pathParams.filter((row) => row && row.key).map((row) => ({ key: row.key, value: row.value ?? '' }));
    }
    if (pathParams && typeof pathParams === 'object') {
        return Object.entries(pathParams).map(([key, value]) => ({ key, value }));
    }
    return [];
}

/**
 * @param {Object} repository
 * @param {string} collectionId
 * @param {string} endpointId
 * @param {import('../protocols/protocolRegistry.js').ProtocolDescriptor} descriptor
 * @param {Object} requestData
 * @returns {Promise<void>}
 */
export async function writeNewEndpointSidecars(repository, collectionId, endpointId, descriptor, requestData) {
    const { createSidecars } = descriptor;

    if (createSidecars.includes('url') || requestData.url) {
        await repository.savePersistedUrl(
            collectionId,
            endpointId,
            requestData.url || requestData.broker || requestData.path || ''
        );
    }

    if (createSidecars.includes('grpcData')) {
        await repository.saveGrpcData(collectionId, endpointId, {
            target: requestData.target || '',
            service: requestData.service || '',
            fullMethod: requestData.fullMethod || '',
            requestJson: requestData.requestJson || '{}'
        });
    }

    if (createSidecars.includes('graphqlData')) {
        await repository.saveGraphQLData(collectionId, endpointId, {
            query: requestData.query || '',
            variables: requestData.variables || '',
            operationName: requestData.operationName || null
        });
    }

    if (createSidecars.includes('mqttData')) {
        const { password: _password, ...mqttData } = normalizeMqttData(requestData);
        await repository.saveMqttData(collectionId, endpointId, mqttData);
    }

    if (createSidecars.includes('websocketData')) {
        await repository.saveWebSocketData(collectionId, endpointId, normalizeWebSocketData(requestData));
    }

    const pathParams = pathParamEntries(requestData.pathParams);
    if (pathParams.length > 0) {
        await repository.savePersistedPathParams(collectionId, endpointId, pathParams);
    }

    const queryParams = normalizeKeyValueRows(requestData.queryParams);
    if (queryParams.length > 0) {
        await repository.savePersistedQueryParams(collectionId, endpointId, queryParams);
    }

    const headers = normalizeKeyValueRows(requestData.headers);
    if (headers.length > 0) {
        await repository.savePersistedHeaders(collectionId, endpointId, headers);
    }

    if (typeof requestData.body === 'string') {
        await repository.saveModifiedRequestBody(collectionId, endpointId, requestData.body);
    }

    const { authConfig } = requestData;
    if (authConfig?.type && authConfig.type !== 'none') {
        await repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
    }
}
