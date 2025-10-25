/**
 * cURL Generator Module
 * Generates cURL commands from request configurations
 */

/**
 * Escapes special characters in shell strings
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeShellArg(str) {
    if (!str) return "''";

    // Replace single quotes with '\'' and wrap in single quotes
    return "'" + str.replace(/'/g, "'\\''") + "'";
}

/**
 * Generates a cURL command from request configuration
 * @param {Object} config - Request configuration
 * @param {string} config.method - HTTP method
 * @param {string} config.url - Request URL
 * @param {Object} config.headers - Request headers
 * @param {Object} config.body - Request body (optional)
 * @returns {string} cURL command
 */
export function generateCurlCommand(config) {
    const { method, url, headers, body } = config;

    let curlParts = ['curl'];

    // Add method (skip for GET as it's default)
    if (method && method !== 'GET') {
        curlParts.push(`-X ${method}`);
    }

    // Add headers
    if (headers && Object.keys(headers).length > 0) {
        for (const [key, value] of Object.entries(headers)) {
            if (key && value) {
                curlParts.push(`-H ${escapeShellArg(`${key}: ${value}`)}`);
            }
        }
    }

    // Add body for POST, PUT, PATCH
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        const bodyString = typeof body === 'string'
            ? body
            : JSON.stringify(body);
        curlParts.push(`-d ${escapeShellArg(bodyString)}`);
    }

    // Add URL (should be last)
    curlParts.push(escapeShellArg(url));

    // Join with line continuation for readability
    return curlParts.join(' \\\n  ');
}
