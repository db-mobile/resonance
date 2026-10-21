/**
 * @fileoverview Normalization helpers for toggleable key-value rows
 * @module utils/keyValueRows
 */

/**
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
 * @param {Array<{key: string, value: string, enabled: boolean}>} queryRows
 * @param {Object<string, string>} authQueryParams
 * @returns {void}
 */
export function appendAuthQueryRows(queryRows, authQueryParams) {
    const rowKeys = new Set(queryRows.map((row) => row.key));
    for (const [key, value] of Object.entries(authQueryParams || {})) {
        if (!rowKeys.has(key)) {
            queryRows.push({ key, value, enabled: true });
        }
    }
}
