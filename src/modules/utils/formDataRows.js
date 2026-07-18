/**
 * @fileoverview Normalization helpers for form-data / urlencoded body rows.
 * The canonical shape is an ordered array of row objects; legacy persisted
 * data used a flat { key: value } object and must keep loading.
 * @module utils/formDataRows
 */

/**
 * Normalize persisted form body fields into the canonical array-of-rows shape.
 * Arrays pass through with defaults applied; legacy flat objects become
 * enabled text rows.
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
 * Whether a normalized row carries any user content worth keeping or sending.
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
