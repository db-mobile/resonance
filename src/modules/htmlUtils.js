/**
 * @fileoverview Shared HTML utility helpers.
 * @module modules/htmlUtils
 */

const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

/**
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}
