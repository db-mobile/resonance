/**
 * @fileoverview Time-and-random based id builder shared by the repositories and services
 * @module utils/ids
 */

/**
 * @param {string} prefix
 * @param {Object} [options]
 * @param {number} [options.length=7]
 * @param {string} [options.separator='_']
 * @returns {string}
 */
export function generateId(prefix, { length = 7, separator = '_' } = {}) {
    const random = Math.random().toString(36).substring(2, 2 + length);
    return `${prefix}${separator}${Date.now()}${separator}${random}`;
}
