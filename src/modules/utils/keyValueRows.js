/**
 * @fileoverview Normalization helpers for toggleable key-value rows
 * (query parameters and request headers).
 * The canonical shape is an ordered array of row objects carrying an `enabled`
 * flag; older persisted data used a flat { key: value } object or entries
 * without the flag and must keep loading as enabled rows.
 * @module utils/keyValueRows
 */

/**
 * Normalize key-value data into the canonical array-of-rows shape.
 * @param {Array|Object|null|undefined} entries
 * @returns {Array<{key: string, value: string, enabled: boolean}>}
 */
export function normalizeKeyValueRows(entries) {
    if (Array.isArray(entries)) {
        return entries.map((row) => ({
            key: typeof row.key === 'string' ? row.key : '',
            value: typeof row.value === 'string' ? row.value : '',
            enabled: row.enabled !== false
        }));
    }
    if (entries && typeof entries === 'object') {
        return Object.entries(entries).map(([key, value]) => ({
            key,
            value: value === undefined || value === null ? '' : String(value),
            enabled: true
        }));
    }
    return [];
}

/**
 * Keep only the rows that are enabled and carry a key.
 * @param {Array|Object|null|undefined} entries
 * @returns {Array<{key: string, value: string, enabled: boolean}>}
 */
export function activeKeyValueRows(entries) {
    return normalizeKeyValueRows(entries).filter((row) => row.key && row.enabled);
}
