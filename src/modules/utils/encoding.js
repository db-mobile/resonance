/**
 * @fileoverview Text encoding helpers shared across modules
 * @module utils/encoding
 */

/**
 * Encodes a UTF-8 string to base64, chunking to avoid call-stack overflow on
 * large bodies.
 *
 * @param {string} text - The text to encode.
 * @returns {string} Base64-encoded UTF-8 bytes.
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
