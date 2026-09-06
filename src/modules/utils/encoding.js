/**
 * @fileoverview Text encoding helpers shared across modules
 * @module utils/encoding
 */

/**
 * @param {string} text
 * @returns {string}
 */
export function textToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}
