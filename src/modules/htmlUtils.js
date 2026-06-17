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
 * Escapes HTML special characters for safe interpolation into markup.
 *
 * Null and undefined collapse to an empty string. Quotes are escaped too, so the
 * result is safe in both text and attribute contexts. Pure string transform with
 * no DOM dependency, so it works in services as well as UI code.
 *
 * @param {*} value - Value to escape.
 * @returns {string} HTML-escaped string.
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}
