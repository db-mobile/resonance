/**
 * @fileoverview cURL command generator for API requests
 * @module modules/curlGenerator
 */

/**
 * Escapes shell arguments for safe use in cURL commands
 *
 * @private
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for shell use
 */
function escapeShellArg(str) {
    if (!str) {return "''";}

    return `'${  str.replace(/'/g, "'\\''")  }'`;
}

/**
 * Generates a cURL command from request configuration
 *
 * @param {Object} config - Request configuration
 * @param {string} config.method - HTTP method
 * @param {string} config.url - Request URL
 * @param {Object} config.headers - Request headers
 * @param {Object|string} [config.body] - Request body
 * @returns {string} Generated cURL command
 *
 * @example
 * const curl = generateCurlCommand({
 *   method: 'POST',
 *   url: 'https://api.example.com/users',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: { name: 'John' }
 * });
 */
export function generateCurlCommand(config) {
    const { method, url, headers, body } = config;

    const curlParts = ['curl'];

    if (method && method !== 'GET') {
        curlParts.push(`-X ${method}`);
    }

    if (headers && Object.keys(headers).length > 0) {
        for (const [key, value] of Object.entries(headers)) {
            if (key && value) {
                curlParts.push(`-H ${escapeShellArg(`${key}: ${value}`)}`);
            }
        }
    }

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string'
            ? body
            : JSON.stringify(body);
        curlParts.push(`-d ${escapeShellArg(bodyString)}`);
    }

    curlParts.push(escapeShellArg(url));

    return curlParts.join(' \\\n  ');
}
