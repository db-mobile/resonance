/**
 * @fileoverview Display helpers for saved examples
 * @module examples/exampleFormat
 */

/**
 * @param {Object} example
 * @returns {number}
 */
export function exampleBodyBytes(example) {
    const body = example?.body ?? '';
    if (example?.bodyEncoding === 'base64') {
        const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
    }
    return new TextEncoder().encode(body).length;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {Object} example
 * @returns {string}
 */
export function exampleMeta(example) {
    const parts = [];
    const type = (example.contentType ?? '').split(';')[0].trim();
    if (type) {
        parts.push(type);
    }
    parts.push(formatBytes(exampleBodyBytes(example)));
    const saved = example.savedAt ? new Date(example.savedAt) : null;
    if (saved && !Number.isNaN(saved.getTime())) {
        parts.push(saved.toLocaleString());
    }
    return parts.join(' · ');
}
