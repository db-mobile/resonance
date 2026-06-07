/**
 * @fileoverview Pure DOM/formatting helpers shared by the Collection Runner UI.
 * @module ui/runner/runnerDomUtils
 */

/**
 * Escapes HTML special characters by round-tripping through a text node.
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

/**
 * Maps an HTTP status code to a CSS class suffix used for colouring.
 *
 * @param {number} statusCode - HTTP status code
 * @returns {string} CSS class suffix
 */
export function getStatusCodeClass(statusCode) {
    if (statusCode >= 200 && statusCode < 300) {return 'success';}
    if (statusCode >= 300 && statusCode < 400) {return 'redirect';}
    if (statusCode >= 400 && statusCode < 500) {return 'client-error';}
    if (statusCode >= 500) {return 'server-error';}
    return 'unknown';
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
 * Gets the reason phrase for a common HTTP status code.
 *
 * @param {number} statusCode - HTTP status code
 * @returns {string} Status text, or '' when unknown
 */
export function getStatusText(statusCode) {
    return STATUS_TEXTS[statusCode] || '';
}
