/**
 * @fileoverview Collection-relative data file references for committed runners
 * @module utils/dataFilePath
 */

/**
 * @param {string|null|undefined} path
 * @returns {boolean}
 */
export function isAbsolutePath(path) {
    return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(path || '');
}

/**
 * @param {string} path
 * @returns {string}
 */
function normalize(path) {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function hasDriveLetter(path) {
    return /^[a-zA-Z]:\//.test(path);
}

/**
 * @param {string} absolutePath
 * @param {string|null|undefined} storagePath
 * @returns {{path: string, portable: boolean}}
 */
export function toCollectionRelativePath(absolutePath, storagePath) {
    const file = absolutePath || '';
    if (!isAbsolutePath(file)) {
        return { path: file, portable: true };
    }
    if (!storagePath) {
        return { path: file, portable: false };
    }
    const normalizedFile = normalize(file);
    const root = normalize(storagePath);
    const prefix = `${root}/`;
    const insensitive = hasDriveLetter(normalizedFile) && hasDriveLetter(root);
    const matches = insensitive
        ? normalizedFile.toLowerCase().startsWith(prefix.toLowerCase())
        : normalizedFile.startsWith(prefix);
    if (!matches) {
        return { path: file, portable: false };
    }
    return { path: normalizedFile.slice(prefix.length), portable: true };
}
