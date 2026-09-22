/**
 * @fileoverview Editor URL template for an HTTP endpoint
 * @module collections/endpointUrl
 */

/**
 * @param {Object} endpoint
 * @param {string} endpoint.path
 * @param {string|null} [endpoint.persistedUrl]
 * @param {*} [endpoint.collectionBaseUrl]
 * @param {Object} [endpoint.parameters]
 * @returns {string}
 */
export function buildEndpointUrl(endpoint) {
    if (endpoint.persistedUrl) {
        return endpoint.persistedUrl;
    }

    let fullUrl = endpoint.path;
    if (endpoint.collectionBaseUrl && !endpoint.path.includes('{{baseUrl}}')) {
        fullUrl = `{{baseUrl}}${endpoint.path}`;
    }

    if (endpoint.parameters?.path) {
        Object.entries(endpoint.parameters.path).forEach(([key]) => {
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const singleBraceParamRegex = new RegExp(`(?<!\\{)\\{${escapedKey}\\}(?!\\})`, 'g');
            fullUrl = fullUrl.replace(singleBraceParamRegex, () => `{{${key}}}`);
        });
    }

    return fullUrl;
}
