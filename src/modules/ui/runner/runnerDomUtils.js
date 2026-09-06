/**
 * @fileoverview Pure DOM/formatting helpers shared by the Collection Runner UI.
 * @module ui/runner/runnerDomUtils
 */

import { statusCategory } from '../../utils/statusCategory.js';

export { escapeHtml } from '../../htmlUtils.js';

/**
 * @param {number} statusCode
 * @returns {string}
 */
export function getStatusCodeClass(statusCode) {
    const category = statusCategory(statusCode);
    return category === 'info' ? 'unknown' : category;
}

const STATUS_TEXTS = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
};

/**
 * @param {number} statusCode
 * @returns {string}
 */
export function getStatusText(statusCode) {
    return STATUS_TEXTS[statusCode] || '';
}
