/**
 * @fileoverview Writes gRPC calls into request history.
 * @module modules/grpcHistory
 *
 * Lives apart from grpcHandler so both the unary path and the streaming handler
 * (which grpcHandler imports) can use it without an import cycle.
 */

import { app } from './appContext.js';
import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { grpcStatusName } from './utils/grpcStatus.js';

/**
 * Resolve the active environment name for the entry, best-effort.
 * @returns {Promise<string|null>} Environment name, or null
 */
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
 * Approximate the response size in bytes for display, since the gRPC commands
 * report no transfer size of their own.
 * @param {*} data - Response payload
 * @returns {number|null} Byte length, or null when there is nothing to measure
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
 * Record one completed gRPC call in history. Never throws — a history failure
 * must not surface as a request failure.
 *
 * Credentials are redacted by HistoryService via `request.headers`, so the
 * `request.grpc` block deliberately carries only non-secret replay context;
 * replay reads the metadata back out of the (redacted) headers.
 *
 * @param {Object} call - The call to record
 * @param {string} call.rawTarget - Target as typed, before variable resolution
 * @param {string} call.target - Resolved target
 * @param {string} call.fullMethod - Full method path, e.g. /pkg.Svc/Method
 * @param {Object} call.metadata - Resolved request metadata
 * @param {*} call.requestJson - Request message (or transcript-opening message)
 * @param {boolean} [call.useTls] - Whether the call used TLS
 * @param {string|null} [call.protoPath] - Proto file backing the call, if any
 * @param {boolean} [call.clientStreaming] - Method streams from the client
 * @param {boolean} [call.serverStreaming] - Method streams from the server
 * @param {string[]} [call.sensitiveNames] - Metadata keys holding credentials
 * @param {Object} call.result - {success, status, statusMessage, data, headers, trailers, ttfb}
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
