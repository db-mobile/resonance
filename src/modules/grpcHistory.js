/**
 * @fileoverview Writes gRPC calls into request history.
 * @module modules/grpcHistory
 */

import { app } from './appContext.js';
import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { grpcStatusName } from './utils/grpcStatus.js';

/** @returns {Promise<string|null>} */
async function getActiveEnvironmentName() {
    try {
        const environment = await app.environmentController?.service?.getActiveEnvironment();
        return environment?.name || null;
    } catch (_e) {
        void _e;
        return null;
    }
}

/**
 * @param {*} data
 * @returns {number|null}
 */
function approximateSize(data) {
    if (data === null || data === undefined) {
        return null;
    }
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    if (!text) {
        return null;
    }
    return new TextEncoder().encode(text).length;
}

/**
 * @param {Object} call
 * @param {string} call.rawTarget
 * @param {string} call.target
 * @param {string} call.fullMethod
 * @param {Object} call.metadata
 * @param {*} call.requestJson
 * @param {boolean} [call.useTls]
 * @param {string|null} [call.protoPath]
 * @param {boolean} [call.clientStreaming]
 * @param {boolean} [call.serverStreaming]
 * @param {string[]} [call.sensitiveNames]
 * @param {Object} call.result
 * @returns {Promise<void>}
 */
export async function recordGrpcHistory(call) {
    if (!app.historyController) {
        return;
    }

    try {
        const { result } = call;
        const environmentName = await getActiveEnvironmentName();

        const requestConfig = {
            protocol: 'grpc',
            method: 'GRPC',
            url: `${call.target}${call.fullMethod}`,
            rawUrl: `${call.rawTarget}${call.fullMethod}`,
            headers: call.metadata || {},
            body: call.requestJson ?? null,
            grpc: {
                target: call.target,
                rawTarget: call.rawTarget,
                fullMethod: call.fullMethod,
                useTls: !!call.useTls,
                protoPath: call.protoPath || null,
                clientStreaming: !!call.clientStreaming,
                serverStreaming: !!call.serverStreaming
            }
        };

        const historyResult = {
            success: !!result.success,
            status: result.status ?? null,
            statusText: grpcStatusName(result.status),
            message: result.statusMessage || '',
            data: result.data ?? null,
            headers: result.headers || {},
            trailers: result.trailers || null,
            ttfb: result.ttfb ?? null,
            size: approximateSize(result.data)
        };

        await app.historyController.addHistoryEntry(
            requestConfig,
            historyResult,
            getCurrentEndpoint(),
            environmentName,
            { headerNames: call.sensitiveNames || [], queryNames: [] }
        );
    } catch (_e) {
        void _e;
    }
}
