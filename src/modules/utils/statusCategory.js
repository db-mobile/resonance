/**
 * @fileoverview Shared HTTP status-code bucketing.
 * @module modules/utils/statusCategory
 */

/**
 * @param {number|null|undefined} statusCode
 * @returns {'success'|'redirect'|'client-error'|'server-error'|'info'}
 */
export function statusCategory(statusCode) {
    if (!statusCode) {
        return 'info';
    }
    if (statusCode >= 200 && statusCode < 300) {
        return 'success';
    }
    if (statusCode >= 300 && statusCode < 400) {
        return 'redirect';
    }
    if (statusCode >= 400 && statusCode < 500) {
        return 'client-error';
    }
    if (statusCode >= 500 && statusCode < 600) {
        return 'server-error';
    }
    return 'info';
}
