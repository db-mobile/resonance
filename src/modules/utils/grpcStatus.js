/**
 * @fileoverview gRPC status-code names and display helpers.
 * @module modules/utils/grpcStatus
 */

/**
 * Canonical gRPC status codes, by numeric value.
 * @type {Readonly<Object<number, string>>}
 * @see https://grpc.io/docs/guides/status-codes/
 */
export const GRPC_STATUS_NAMES = Object.freeze({
    0: 'OK',
    1: 'CANCELLED',
    2: 'UNKNOWN',
    3: 'INVALID_ARGUMENT',
    4: 'DEADLINE_EXCEEDED',
    5: 'NOT_FOUND',
    6: 'ALREADY_EXISTS',
    7: 'PERMISSION_DENIED',
    8: 'RESOURCE_EXHAUSTED',
    9: 'FAILED_PRECONDITION',
    10: 'ABORTED',
    11: 'OUT_OF_RANGE',
    12: 'UNIMPLEMENTED',
    13: 'INTERNAL',
    14: 'UNAVAILABLE',
    15: 'DATA_LOSS',
    16: 'UNAUTHENTICATED'
});

/**
 * Names a gRPC status code. Unknown codes fall back to `CODE_<n>` so an entry
 * never renders a bare number that could be mistaken for an HTTP status.
 *
 * @param {number|null|undefined} code - Numeric gRPC status code
 * @returns {string} Status name, or '' when no code was reported
 */
export function grpcStatusName(code) {
    if (code === null || code === undefined || Number.isNaN(Number(code))) {
        return '';
    }
    return GRPC_STATUS_NAMES[code] || `CODE_${code}`;
}

/**
 * Whether a gRPC call succeeded. Only code 0 (OK) is success — note that 0 is
 * falsy, so callers must test against null/undefined rather than truthiness.
 *
 * @param {number|null|undefined} code - Numeric gRPC status code
 * @returns {boolean} True when the code is 0
 */
export function isGrpcStatusOk(code) {
    if (code === null || code === undefined || code === '') {
        return false;
    }
    return Number(code) === 0;
}
