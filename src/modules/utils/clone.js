/**
 * @fileoverview JSON deep clone that passes undefined through
 * @module utils/clone
 */

/**
 * @param {*} value
 * @returns {*}
 */
export function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
