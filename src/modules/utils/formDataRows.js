/**
 * @fileoverview Normalization helpers for form-data / urlencoded body rows.
 * @module utils/formDataRows
 */

/**
 * @param {Array|Object|null|undefined} fields
 * @returns {Array<{key: string, value: string, type: ('text'|'file'), filePath: string, contentType: string, enabled: boolean}>}
 */
export function normalizeFormRows(fields) {
    if (Array.isArray(fields)) {
        return fields.map((row) => ({
            key: typeof row.key === 'string' ? row.key : '',
            value: typeof row.value === 'string' ? row.value : '',
            type: row.type === 'file' ? 'file' : 'text',
            filePath: typeof row.filePath === 'string' ? row.filePath : '',
            contentType: typeof row.contentType === 'string' ? row.contentType : '',
            enabled: row.enabled !== false
        }));
    }
    if (fields && typeof fields === 'object') {
        return Object.entries(fields).map(([key, value]) => ({
            key,
            value: String(value),
            type: 'text',
            filePath: '',
            contentType: '',
            enabled: true
        }));
    }
    return [];
}

/**
 * @param {{key?: string, value?: string, filePath?: string}} row
 * @returns {boolean}
 */
export function isMeaningfulRow(row) {
    return Boolean(
        (row.key && row.key.trim()) ||
        (row.value && row.value.trim()) ||
        (row.filePath && row.filePath.trim())
    );
}
