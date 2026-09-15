/**
 * @fileoverview Shared size capping for persisted request/response bodies
 * @module utils/truncateBody
 */

/**
 * @param {*} value
 * @param {number} limit
 * @returns {{value: *, truncated: boolean, originalSize: number}}
 */
export function truncateBody(value, limit) {
    if (value === null || value === undefined) {
        return { value, truncated: false, originalSize: 0 };
    }

    const text = typeof value === 'string' ? value : JSON.stringify(value);

    if (typeof text !== 'string') {
        return { value, truncated: false, originalSize: 0 };
    }

    if (text.length <= limit) {
        return { value, truncated: false, originalSize: text.length };
    }

    return {
        value: text.substring(0, limit),
        truncated: true,
        originalSize: text.length
    };
}
