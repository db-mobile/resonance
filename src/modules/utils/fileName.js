/**
 * @fileoverview Display name of a file-system path
 * @module utils/fileName
 */

/**
 * @param {string} path
 * @returns {string}
 */
export function fileNameFromPath(path) {
    return path.split(/[/\\]/).filter(Boolean).pop() || path;
}
